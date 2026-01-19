# Renewal Risk Frontend

React dashboard for viewing and managing renewal risk.

## Setup

```bash
npm install
npm run dev
```

Opens at http://localhost:3000

## Features

- **Summary Cards**: Total residents, high/medium/low risk counts
- **Risk Table**: Sortable list of at-risk residents
- **Expandable Rows**: Click to view risk signal details
- **Trigger Event**: Send webhook to RMS for individual residents
- **Recalculate**: Run fresh risk calculation

## Configuration

The API proxy is configured in `vite.config.ts`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true
  }
}
```

## Component Structure

```
src/
├── components/
│   └── RenewalRiskDashboard.tsx   # Main dashboard component
├── types.ts                        # TypeScript interfaces
├── App.tsx                         # Root component
├── main.tsx                        # Entry point
└── index.css                       # Tailwind imports
```

## Build

```bash
npm run build
```

Output in `dist/` folder.
