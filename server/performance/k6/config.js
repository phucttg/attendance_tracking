/**
 * k6 Performance Test - Shared Configuration
 */

// Base URL for the API
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:9999';

// Test Users (pre-seeded in database)
export const TEST_USERS = {
    employees: [
        { identifier: 'employee1@test.com', password: 'Password123' },
        { identifier: 'employee2@test.com', password: 'Password123' },
        { identifier: 'employee3@test.com', password: 'Password123' },
    ],
    managers: [
        { identifier: 'manager1@test.com', password: 'Password123' },
        { identifier: 'manager2@test.com', password: 'Password123' },
    ],
    admins: [
        { identifier: 'admin@test.com', password: 'Password123' },
    ]
};

// Standard thresholds for all tests
export const STANDARD_THRESHOLDS = {
    http_req_duration: ['p(95)<500'],  // 95% requests < 500ms
    http_req_failed: ['rate<0.01'],    // Error rate < 1%
};

// Strict thresholds for login tests
export const LOGIN_THRESHOLDS = {
    http_req_duration: ['p(95)<300'],  // 95% requests < 300ms
    http_req_failed: ['rate<0.001'],   // Error rate < 0.1%
};

// High load thresholds (allow some degradation)
export const STRESS_THRESHOLDS = {
    http_req_duration: ['p(95)<2000'], // 95% requests < 2s
    http_req_failed: ['rate<0.05'],    // Error rate < 5%
};
