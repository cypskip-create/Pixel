/**
 * Official Google Calendar REST v3 adapter for Pixel (`pixel.google-calendar`).
 *
 * Security & scope invariants:
 * - Least-privilege scopes: starts with `calendar.readonly`; write operations
 *   (`create`, `update`, `delete`) require `calendar.events` scope AND Pixel
 *   `PermissionBroker` approval.
 * - Enforces token audience matching (`https://www.googleapis.com`) so OAuth
 *   tokens can never be sent to any other host.
 * - Treats all returned event summaries, descriptions, and attendee fields as
 *   untrusted external data.
 */

import { assertTokenAudience, hasRequiredScope, isTokenExpired, type FetchLike, type OAuthTokenRecord } from './oauth';
import { redactTaskText } from '../tasks/schema';

export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_CALENDAR_AUDIENCE = 'https://www.googleapis.com';
export const GOOGLE_CALENDAR_SCOPE_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_CALENDAR_SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';

export interface CalendarSummary {
  id: string;
  summary: string;
  timeZone: string;
  primary: boolean;
  accessRole: string;
}

export interface CalendarEventView {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  status: string;
  htmlLink?: string;
}

function validateCalendarId(raw: unknown): string {
  const id = typeof raw === 'string' && raw.trim() ? raw.trim() : 'primary';
  if (id.length > 200 || id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Invalid Google Calendar ID.');
  }
  return id;
}

function validateEventId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid Google Calendar event ID.');
  }
  return id;
}

function normalizeEvent(raw: Record<string, unknown>): CalendarEventView {
  const startObj = (raw.start && typeof raw.start === 'object' ? raw.start : {}) as Record<string, unknown>;
  const endObj = (raw.end && typeof raw.end === 'object' ? raw.end : {}) as Record<string, unknown>;
  const allDay = typeof startObj.date === 'string' && !startObj.dateTime;
  return {
    id: String(raw.id ?? ''),
    summary: redactTaskText(String(raw.summary ?? '(No title)')).slice(0, 200),
    start: String(startObj.dateTime ?? startObj.date ?? ''),
    end: String(endObj.dateTime ?? endObj.date ?? ''),
    allDay,
    ...(typeof raw.location === 'string' && raw.location ? { location: redactTaskText(raw.location).slice(0, 200) } : {}),
    ...(typeof raw.description === 'string' && raw.description ? { description: redactTaskText(raw.description).slice(0, 1_500) } : {}),
    status: String(raw.status ?? 'confirmed'),
    ...(typeof raw.htmlLink === 'string' ? { htmlLink: raw.htmlLink.slice(0, 300) } : {}),
  };
}

export class GoogleCalendarClient {
  constructor(
    private readonly getToken: () => OAuthTokenRecord | null,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private requireToken(writeRequired: boolean, targetUrl: string): OAuthTokenRecord {
    const token = this.getToken();
    if (!token) {
      throw new Error('Google Calendar is not connected. Connect your account in Settings → Plugins & Connections.');
    }
    if (isTokenExpired(token)) {
      throw new Error('Google Calendar access token has expired. Reconnect or refresh your account.');
    }
    assertTokenAudience(token, targetUrl);
    if (writeRequired) {
      if (!hasRequiredScope(token, GOOGLE_CALENDAR_SCOPE_EVENTS)) {
        throw new Error('Google Calendar write scope (calendar.events) is not granted. Reconnect with write permission.');
      }
    } else if (
      !hasRequiredScope(token, GOOGLE_CALENDAR_SCOPE_READONLY) &&
      !hasRequiredScope(token, GOOGLE_CALENDAR_SCOPE_EVENTS)
    ) {
      throw new Error('Google Calendar read scope is not granted.');
    }
    return token;
  }

  private async apiRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    pathAndQuery: string,
    writeRequired: boolean,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const url = `${GOOGLE_CALENDAR_API_BASE}${pathAndQuery}`;
    const token = this.requireToken(writeRequired, url);
    const resp = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    if (resp.status === 401) throw new Error('Google Calendar rejected credentials (HTTP 401). Reconnect your account.');
    if (resp.status === 403) throw new Error('Google Calendar denied access (HTTP 403). Check calendar permissions or scopes.');
    if (resp.status === 429) throw new Error('Google Calendar rate limit reached (HTTP 429). Try again shortly.');
    if (resp.status === 204) return {};
    if (!resp.ok) throw new Error(`Google Calendar API returned HTTP ${resp.status}.`);
    const data = (await resp.json()) as Record<string, unknown>;
    return data && typeof data === 'object' ? data : {};
  }

  async listCalendars(signal?: AbortSignal): Promise<CalendarSummary[]> {
    const data = await this.apiRequest('GET', '/users/me/calendarList?maxResults=25', false, undefined, signal);
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === 'object'))
      .slice(0, 25)
      .map((i) => ({
        id: String(i.id ?? ''),
        summary: redactTaskText(String(i.summary ?? '')).slice(0, 150),
        timeZone: String(i.timeZone ?? 'UTC'),
        primary: i.primary === true,
        accessRole: String(i.accessRole ?? 'reader'),
      }));
  }

  async listEvents(options: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxResults?: number;
    timeZone?: string;
  } = {}, signal?: AbortSignal): Promise<CalendarEventView[]> {
    const calId = validateCalendarId(options.calendarId);
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(Math.max(1, Math.min(30, options.maxResults ?? 15))),
    });
    if (options.timeMin) params.set('timeMin', options.timeMin);
    else if (!options.query) params.set('timeMin', new Date().toISOString());
    if (options.timeMax) params.set('timeMax', options.timeMax);
    if (options.query) params.set('q', options.query.slice(0, 200));
    if (options.timeZone) params.set('timeZone', options.timeZone.slice(0, 80));

    const data = await this.apiRequest(
      'GET',
      `/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
      false,
      undefined,
      signal,
    );
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === 'object'))
      .slice(0, 30)
      .map(normalizeEvent);
  }

  async getEvent(calendarId: string | undefined, eventId: string, signal?: AbortSignal): Promise<CalendarEventView> {
    const calId = validateCalendarId(calendarId);
    const evId = validateEventId(eventId);
    const data = await this.apiRequest(
      'GET',
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`,
      false,
      undefined,
      signal,
    );
    return normalizeEvent(data);
  }

  async createEvent(input: {
    calendarId?: string;
    summary: string;
    start: string;
    end: string;
    allDay?: boolean;
    description?: string;
    location?: string;
    timeZone?: string;
  }, signal?: AbortSignal): Promise<CalendarEventView> {
    const calId = validateCalendarId(input.calendarId);
    const summary = input.summary.trim().slice(0, 200);
    if (!summary) throw new Error('Event summary/title is required.');
    const body: Record<string, unknown> = {
      summary,
      start: input.allDay ? { date: input.start } : { dateTime: input.start, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
      end: input.allDay ? { date: input.end } : { dateTime: input.end, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
      ...(input.description ? { description: input.description.slice(0, 4_000) } : {}),
      ...(input.location ? { location: input.location.slice(0, 300) } : {}),
    };
    const data = await this.apiRequest(
      'POST',
      `/calendars/${encodeURIComponent(calId)}/events`,
      true,
      body,
      signal,
    );
    return normalizeEvent(data);
  }

  async updateEvent(input: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    description?: string;
    location?: string;
  }, signal?: AbortSignal): Promise<CalendarEventView> {
    const calId = validateCalendarId(input.calendarId);
    const evId = validateEventId(input.eventId);
    const body: Record<string, unknown> = {};
    if (input.summary !== undefined) body.summary = input.summary.trim().slice(0, 200);
    if (input.start !== undefined) body.start = input.allDay ? { date: input.start } : { dateTime: input.start };
    if (input.end !== undefined) body.end = input.allDay ? { date: input.end } : { dateTime: input.end };
    if (input.description !== undefined) body.description = input.description.slice(0, 4_000);
    if (input.location !== undefined) body.location = input.location.slice(0, 300);
    const data = await this.apiRequest(
      'PATCH',
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`,
      true,
      body,
      signal,
    );
    return normalizeEvent(data);
  }

  async deleteEvent(calendarId: string | undefined, eventId: string, signal?: AbortSignal): Promise<{ deleted: true; eventId: string }> {
    const calId = validateCalendarId(calendarId);
    const evId = validateEventId(eventId);
    await this.apiRequest(
      'DELETE',
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`,
      true,
      undefined,
      signal,
    );
    return { deleted: true, eventId: evId };
  }
}
