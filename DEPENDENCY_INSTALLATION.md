# Dependency Installation Guide

This file contains all dependency installation commands for the `department-rag` app.

## Prerequisites

- Node.js 20+
- npm 10+

Check versions:

```bash
node -v
npm -v
```

## Install All Project Dependencies

From the `department-rag` folder:

```bash
npm install
```

This installs everything listed in `package.json`, including:

- Runtime dependencies (`dependencies`)
- Development dependencies (`devDependencies`)

## Clean Install (Recommended for Fresh Setup)

```bash
rm -rf node_modules package-lock.json
npm install
```

If you are on Windows PowerShell, use:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

## Install Single Packages (If Needed)

Runtime package example:

```bash
npm install <package-name>
```

Dev package example:

```bash
npm install -D <package-name>
```

## Verify Installation

```bash
npm run lint
npm run build
```

If both commands pass, dependencies are installed correctly.

## Optional: Update Dependencies

```bash
npm outdated
npm update
```

## Notes

- Keep `.env.local` configured before running app features that use external services.
- Supabase schema setup is required separately using `supabase_schema.sql`.
