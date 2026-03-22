import mongoose from 'mongoose';
import Holiday from '../models/Holiday.js';
import {
  assertHolidayMutationEnvironment,
  getConnectionOptions,
  getMongoConnectionUri
} from './database.js';

// Connect to MongoDB using connection string from environment variable
// Throws error if connection fails - caller (server.js) handles the error
const connectDB = async () => {
  const uri = getMongoConnectionUri();
  if (!uri) {
    throw new Error('MONGO_URI environment variable is required');
  }

  const conn = await mongoose.connect(uri, getConnectionOptions());
  await Holiday.init();

  const indexes = await Holiday.collection.indexes();
  const hasUniqueDateIndex = indexes.some((index) => index.unique === true && index.key?.date === 1);
  if (!hasUniqueDateIndex) {
    throw new Error('Holiday unique index on date is missing');
  }

  assertHolidayMutationEnvironment();
  console.log(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};

export default connectDB;
