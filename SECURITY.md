# Security

## Reporting a problem

Please don't open a public issue for a security problem. Use **Report a vulnerability** on
the repository's Security tab (GitHub private vulnerability reporting), with what you found
and how to reproduce it. We'll reply within a few days and credit you in the fix if you like.

## How FlowCommit protects your computer

FlowCommit runs a small server on your computer that can read and write your project, run
Git, and ask your AI tools to read your code. It's built so that only you can use it:

- **It only listens on this computer** (`127.0.0.1`), never on your network.
- **It only answers pages served from this computer.** Requests whose `Host` isn't
  `localhost`, `127.0.0.1` or `[::1]` are refused, which stops DNS rebinding. Requests from a
  page on another site (a different `Origin`) are refused, so a website you visit can't use it.
- **Pages say which project they show.** A page left open after switching projects can't
  save into the new one.
- **AI tools only read your code** when FlowCommit asks them to analyze it. They run with
  read-only tools; changes to code happen only in your own Claude Code or Codex session,
  where you approve them.
- **Files open only from inside the project.** Opening a step's file checks its real path,
  so a link inside the project can't open something outside it.
- **No accounts, keys or telemetry.** FlowCommit uses the Claude Code or Codex sign-in you
  already have. It only goes online when you ask it to (pushing, pulling or checking
  GitHub), apart from the editor loading its typeface from Google Fonts.

### What it doesn't protect against

Other programs running on your computer as you. They can already read and change your
project folder directly, so a password on the local server wouldn't add real protection.

## Supported versions

Only the latest release gets security fixes while FlowCommit is before version 1.0.
