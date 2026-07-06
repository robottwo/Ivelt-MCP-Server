# Contributing

Contributions are welcome. This project uses the standard **fork & pull request**
workflow — you can't push directly to this repository; instead you propose changes
and the maintainer reviews and merges them. **Nothing is merged without the
maintainer's approval.**

## How to propose a change

1. **Fork** this repository to your own GitHub account (the "Fork" button, top-right).
2. **Clone your fork** and create a branch:
   ```bash
   git clone https://github.com/<your-username>/<repo>.git
   cd <repo>
   git checkout -b my-change
   ```
3. **Make your change.** Verify it passes the same checks CI runs:
   ```bash
   npm install
   npm run lint && npm run format:check && npm run typecheck
   npm run build
   npm test
   ```
4. **Commit and push** to your fork:
   ```bash
   git commit -am "Describe your change"
   git push origin my-change
   ```
5. **Open a Pull Request** from your branch to this repo's `main`. Describe _what_
   you changed and _why_.

The maintainer will review it, may ask for changes, and will merge it once approved.

## Guidelines

- Keep pull requests focused — one logical change per PR is easier to review.
- This project is **read-only** and uses only **public** forum data. Please don't add
  features that post/edit on the forum or that try to de-anonymize or track users.
- Match the existing code style (TypeScript, small focused modules). CI enforces
  ESLint, Prettier, typecheck, build, and the unit tests — run them locally first.
- Be respectful of the forum communities this server is pointed at, and of each forum's terms of use.
