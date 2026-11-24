import { useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Mic, Paperclip, ScreenShare, Square, X } from 'lucide-react';
import type { ImageAttachment } from '@shared/types';
import { IconButton } from '@/components/IconButton';

interface WorkspaceComposerProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  attachments: ImageAttachment[];
  onAttach: (attachment: ImageAttachment) => void;
  onRemoveAttachment: (index: number) => void;
  onAttachScreenshot: () => void;
  onToggleListening: () => void;
  listening: boolean;
  onNotice: (message: string) => void;
}

const MAX_ATTACHMENTS = 4;
const MAX_COMPOSER_HEIGHT = 160;

export function WorkspaceComposer({
  draft, onDraftChange, onSubmit, onStop, streaming, disabled, attachments,
  onAttach, onRemoveAttachment, onAttachScreenshot, onToggleListening,
  listening, onNotice,
}: WorkspaceComposerProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasContent = draft.trim().length > 0 || attachments.length > 0;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 42), MAX_COMPOSER_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_COMPOSER_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!streaming && !disabled && hasContent) onSubmit();
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const files = [...(event.currentTarget.files ?? [])]
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, remaining);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') return;
        onAttach({
          dataUrl: reader.result,
          mimeType: file.type as ImageAttachment['mimeType'],
          width: 0,
          height: 0,
          source: 'upload',
          label: file.name,
        });
      };
      reader.onerror = () => onNotice(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    }
    if (event.currentTarget.files?.length && files.length < event.currentTarget.files.length) {
      onNotice(remaining === 0
        ? 'Pixel can attach up to four images per message.'
        : 'Pixel accepts PNG, JPEG, WebP and GIF images, up to four per message.');
    }
    event.currentTarget.value = '';
  };

  return (
    <div className="workspace-composer">
      {attachments.length > 0 ? (
        <div className="workspace-attachment-list" aria-label="Message attachments">
          {attachments.map((attachment, index) => (
            <div key={`${attachment.label ?? 'image'}-${index}`} className="workspace-attachment">
              <img src={attachment.dataUrl} alt="" />
              <span title={attachment.label ?? 'Image'}>{attachment.label ?? 'Image'}</span>
              <button type="button" aria-label={`Remove ${attachment.label ?? 'image'}`} onClick={() => onRemoveAttachment(index)}>
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        aria-label="Message Pixel"
        aria-describedby="workspace-composer-hint"
        title="Enter to send · Shift+Enter for a new line"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Restoring chat…' : 'Ask Pixel anything…'}
        disabled={disabled}
        rows={1}
        className="workspace-composer-input selectable"
      />

      <div className="workspace-composer-footer">
        <div className="workspace-composer-tools">
          <IconButton label={listening ? 'Stop voice input' : 'Voice input'} onClick={onToggleListening} active={listening}>
            <Mic size={16} aria-hidden="true" />
          </IconButton>
          <IconButton label="Capture active window" onClick={onAttachScreenshot}>
            <ScreenShare size={15} aria-hidden="true" />
          </IconButton>
          <IconButton label="Attach images" onClick={() => fileRef.current?.click()}>
            <Paperclip size={16} aria-hidden="true" />
          </IconButton>
          <span id="workspace-composer-hint" className="sr-only">Enter sends. Shift plus Enter inserts a new line.</span>
        </div>

        {streaming ? (
          <button type="button" className="workspace-stop-button" onClick={onStop}>
            <Square size={13} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button type="button" aria-label="Send message" title="Send" className="workspace-send-button" onClick={onSubmit} disabled={disabled || !hasContent}>
            <ArrowUp size={17} aria-hidden="true" />
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="sr-only"
        aria-label="Choose image attachments"
        onChange={handleFiles}
      />
    </div>
  );
}
