import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isReplicaSetAvailable } from '../src/config/database.js';

describe('🧪 VERIFICATION: P0 Fix - Production Auto-Assume', () => {
  // Store original env vars
  let originalNodeEnv;
  let originalMongoUri;
  let originalLegacyMongoUri;
  let originalReplicaSet;

  beforeEach(() => {
    // Save originals
    originalNodeEnv = process.env.NODE_ENV;
    originalMongoUri = process.env.MONGO_URI;
    originalLegacyMongoUri = process.env.MONGODB_URI;
    originalReplicaSet = process.env.MONGODB_REPLICA_SET;
  });

  afterEach(() => {
    // Restore originals
    process.env.NODE_ENV = originalNodeEnv;
    process.env.MONGO_URI = originalMongoUri;
    process.env.MONGODB_URI = originalLegacyMongoUri;
    process.env.MONGODB_REPLICA_SET = originalReplicaSet;
  });

  describe('CRITICAL: Production should NOT auto-assume replica set', () => {
    it('P0 FIX: Production without explicit config should default to FALSE (safe)', () => {
      // Setup: Production environment without MONGODB_REPLICA_SET
      process.env.NODE_ENV = 'production';
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb://localhost:27017/prod_db';

      console.log('\n🔴 CRITICAL TEST: Production without explicit MONGODB_REPLICA_SET');
      console.log('  NODE_ENV:', process.env.NODE_ENV);
      console.log('  MONGODB_REPLICA_SET:', process.env.MONGODB_REPLICA_SET);
      console.log('  MONGODB_URI:', process.env.MONGODB_URI);
      
      const result = isReplicaSetAvailable();
      
      console.log('  Result:', result);
      console.log('  Expected: false (safe default, no crash risk)');
      console.log('  ✅ This prevents production crashes when MongoDB is standalone');
      
      // MUST be false to prevent crash
      expect(result).toBe(false);
    });

    it('Production with explicit MONGODB_REPLICA_SET=true should return TRUE', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_REPLICA_SET = 'true';
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb://replica1,replica2,replica3/prod_db?replicaSet=rs0';

      console.log('\n✅ Production with explicit config');
      const result = isReplicaSetAvailable();
      
      console.log('  MONGODB_REPLICA_SET=true → Result:', result);
      expect(result).toBe(true);
    });

    it('Production with explicit MONGODB_REPLICA_SET=false should return FALSE', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_REPLICA_SET = 'false';
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb://localhost:27017/prod_db';

      console.log('\n✅ Production with explicit standalone config');
      const result = isReplicaSetAvailable();
      
      console.log('  MONGODB_REPLICA_SET=false → Result:', result);
      expect(result).toBe(false);
    });
  });

  describe('Atlas Detection (mongodb+srv)', () => {
    it('Should detect Atlas URI and enable transactions', () => {
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb+srv://user:pass@cluster0.mongodb.net/mydb?retryWrites=true';

      console.log('\n🌐 Atlas URI detection');
      console.log('  URI:', process.env.MONGODB_URI);
      
      const result = isReplicaSetAvailable();
      
      console.log('  Result:', result);
      console.log('  Expected: true (Atlas has replica set)');
      
      expect(result).toBe(true);
    });

    it('Atlas detection should work even in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb+srv://user@cluster.mongodb.net/db';

      const result = isReplicaSetAvailable();
      
      console.log('\n🌐 Production + Atlas URI');
      console.log('  Result:', result, '(auto-detected from mongodb+srv)');
      
      expect(result).toBe(true);
    });
  });

  describe('ReplicaSet Parameter Detection', () => {
    it('Should detect replicaSet parameter in URI', () => {
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb://host1:27017,host2:27017,host3:27017/mydb?replicaSet=rs0';

      console.log('\n🔗 ReplicaSet parameter detection');
      const result = isReplicaSetAvailable();
      
      console.log('  Result:', result);
      expect(result).toBe(true);
    });
  });

  describe('Explicit Config Takes Priority', () => {
    it('Explicit false should override Atlas URI', () => {
      process.env.MONGODB_REPLICA_SET = 'false';
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb+srv://user@cluster.mongodb.net/db';

      console.log('\n⚙️  Explicit config overrides detection');
      const result = isReplicaSetAvailable();
      
      console.log('  MONGODB_REPLICA_SET=false + Atlas URI → Result:', result);
      console.log('  (Explicit config wins)');
      
      expect(result).toBe(false);
    });

    it('Explicit true should override standalone URI', () => {
      process.env.MONGODB_REPLICA_SET = 'true';
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb://localhost:27017/db';

      const result = isReplicaSetAvailable();
      
      console.log('\n⚙️  MONGODB_REPLICA_SET=true + standalone URI → Result:', result);
      expect(result).toBe(true);
    });
  });

  describe('Development Environment', () => {
    it('Development without config should default to FALSE', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = 'mongodb://localhost:27017/dev_db';

      console.log('\n🛠️  Development environment');
      const result = isReplicaSetAvailable();
      
      console.log('  Result:', result, '(safe standalone mode)');
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('Should handle missing MONGODB_URI', () => {
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      delete process.env.MONGODB_URI;

      const result = isReplicaSetAvailable();
      
      console.log('\n🔍 Missing URI → Result:', result);
      expect(result).toBe(false);
    });

    it('Should handle empty MONGODB_URI', () => {
      delete process.env.MONGODB_REPLICA_SET;
      delete process.env.MONGO_URI;
      process.env.MONGODB_URI = '';

      const result = isReplicaSetAvailable();
      expect(result).toBe(false);
    });

    it('Should be case-sensitive for explicit config', () => {
      process.env.MONGODB_REPLICA_SET = 'TRUE'; // Wrong case
      delete process.env.MONGO_URI;
      
      const result = isReplicaSetAvailable();
      
      console.log('\n🔍 Case sensitivity: MONGODB_REPLICA_SET=TRUE → Result:', result);
      console.log('  (Must be lowercase "true")');
      
      expect(result).toBe(false); // Should NOT match 'TRUE'
    });
  });

  describe('Regression Tests', () => {
    it('Should maintain backward compatibility with existing configs', () => {
      // Test various valid configurations
      const configs = [
        { env: 'true', uri: 'mongodb://localhost:27017/db', expected: true },
        { env: 'false', uri: 'mongodb://localhost:27017/db', expected: false },
        { env: undefined, uri: 'mongodb+srv://cluster.mongodb.net/db', expected: true },
        { env: undefined, uri: 'mongodb://localhost:27017/db?replicaSet=rs0', expected: true },
        { env: undefined, uri: 'mongodb://localhost:27017/db', expected: false },
      ];

      console.log('\n🔄 Backward compatibility tests:');
      configs.forEach((config, i) => {
        if (config.env) {
          process.env.MONGODB_REPLICA_SET = config.env;
        } else {
          delete process.env.MONGODB_REPLICA_SET;
        }
        delete process.env.MONGO_URI;
        process.env.MONGODB_URI = config.uri;

        const result = isReplicaSetAvailable();
        console.log(`  ${i + 1}. env=${config.env}, uri=${config.uri.substring(0, 40)}... → ${result}`);
        
        expect(result).toBe(config.expected);
      });
    });
  });
});
