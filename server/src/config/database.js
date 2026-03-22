/**
 * Database Configuration Module
 * 
 * Handles MongoDB connection settings and transaction capabilities detection.
 * Provides utilities for determining if MongoDB is running as a replica set,
 * which is required for multi-document transactions.
 * 
 * Environment Variables:
 * - MONGODB_REPLICA_SET: Explicit flag ('true'/'false') to enable/disable transactions
 * - MONGO_URI: Canonical connection string
 * - MONGODB_URI: Legacy fallback connection string
 */

export const getMongoConnectionUri = () => {
  return process.env.MONGO_URI || process.env.MONGODB_URI || '';
};

/**
 * Check if MongoDB replica set is available for transactions
 * 
 * MongoDB transactions require a replica set or sharded cluster.
 * Standalone MongoDB instances do not support transactions.
 * 
 * Detection Methods (in order of priority):
 * 1. Explicit MONGODB_REPLICA_SET environment variable
 * 2. Parse connection string for replicaSet parameter
 * 3. Default to standalone (no transactions)
 * 
 * @returns {boolean} True if transactions are available, false otherwise
 */
export const isReplicaSetAvailable = () => {
  // Method 1: Explicit configuration takes precedence
  const explicitFlag = process.env.MONGODB_REPLICA_SET;
  if (explicitFlag === 'true') {
    return true;
  }
  if (explicitFlag === 'false') {
    return false;
  }

  // Method 2: Parse connection string for replicaSet parameter
  const uri = getMongoConnectionUri();
  
  // Atlas (mongodb+srv) almost always has replica set
  if (uri.startsWith('mongodb+srv://')) {
    console.info('ℹ️  Detected MongoDB Atlas URI (mongodb+srv), enabling transactions');
    return true;
  }
  
  // Explicit replicaSet parameter in connection string
  if (uri.includes('replicaSet=')) {
    console.info('ℹ️  Detected replicaSet parameter in URI, enabling transactions');
    return true;
  }

  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    console.warn(
      '⚠️  HOLIDAY MUTATION WARNING: MONGODB_REPLICA_SET is not explicitly set.\n' +
      '   Transaction detection is falling back to URI inspection only.'
    );
  }

  return false;
};

export const requiresHolidayMutationTransactions = () => {
  return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
};

export const assertHolidayMutationEnvironment = () => {
  if (!requiresHolidayMutationTransactions()) {
    return;
  }

  if (!isReplicaSetAvailable()) {
    throw new Error(
      'Holiday mutations require MongoDB transaction support in production/staging. ' +
      'Set MONGODB_REPLICA_SET=true or use a replica set / mongos connection.'
    );
  }
};

/**
 * Get database connection options based on environment
 * 
 * @returns {Object} MongoDB connection options
 */
export const getConnectionOptions = () => {
  const options = {
    // Recommended settings for production
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 5000,
  };

  return options;
};

/**
 * Transaction options for session.withTransaction()
 * 
 * These options ensure strong consistency and durability for transactions:
 * - snapshot: Reads see consistent snapshot of data
 * - majority: Writes acknowledged by majority of replica set
 * - primary: Reads from primary node only
 * 
 * @returns {Object} MongoDB transaction options
 */
export const getTransactionOptions = () => {
  return {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
    readPreference: 'primary'
  };
};
