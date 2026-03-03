// Load environment variables from .env file FIRST (before any other imports use them)
import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';
import { runAutoCloseCatchupOnStartup, startAutoCloseScheduler } from './services/autoCloseService.js';

const PORT = process.env.PORT;

if (!PORT) {
  console.error('PORT is not defined in .env');
  process.exit(1);
}

// Connect to MongoDB first, then start server
// Pattern: DB must be ready before accepting HTTP requests
connectDB()
  .then(async () => {
    await runAutoCloseCatchupOnStartup();
    startAutoCloseScheduler();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    // If DB fails, exit immediately - server can't work without database
    console.error('Failed to connect DB:', err.message);
    process.exit(1);
  });
