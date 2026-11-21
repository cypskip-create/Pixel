// Managed sandboxes may deny writes to the real Windows profile. Tests can
// opt into an isolated workspace directory without changing the shell HOME.
if (process.env.PIXEL_TEST_HOME) process.env.USERPROFILE = process.env.PIXEL_TEST_HOME;
