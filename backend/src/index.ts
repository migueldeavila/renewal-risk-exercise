import express from 'express';
import dotenv from 'dotenv';
import renewalRiskRoutes from './api/renewalRisk';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api/v1', renewalRiskRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
