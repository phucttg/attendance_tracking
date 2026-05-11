import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/jwt.js';

const notDeletedCondition = {
  $or: [
    { deletedAt: null },
    { deletedAt: { $exists: false } }
  ]
};

const toAuthUserProfile = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  username: user.username,
  role: user.role,
  employeeCode: user.employeeCode,
  teamId: user.teamId,
  startDate: user.startDate
});

/**
 * Validates login credentials and returns JWT + user profile.
 * @param {string} identifier - Email or username
 * @param {string} password - Plain text password
 * @returns {Promise<{token: string, user: Object}>}
 */
export const loginUser = async (identifier, password) => {
  const normalizedIdentifier = identifier.toLowerCase().trim();

  const user = await User.findOne({
    $and: [
      {
        $or: [
          { email: normalizedIdentifier },
          { username: normalizedIdentifier }
        ]
      },
      notDeletedCondition
    ]
  });

  // SECURITY: Same error message prevents user enumeration attacks
  if (!user) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('Account is deactivated');
    error.statusCode = 403;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    // SECURITY: Same error message prevents user enumeration attacks
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // SECURITY: Minimal JWT payload to reduce token size and exposure
  const token = jwt.sign(
    { userId: user._id, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return {
    token,
    user: toAuthUserProfile(user)
  };
};

/**
 * Get current user profile by ID.
 * @param {string} userId - User's ObjectId
 * @returns {Promise<Object>} User profile
 */
export const getCurrentUser = async (userId) => {
  const user = await User.findOne({
    _id: userId,
    ...notDeletedCondition
  }).select('-passwordHash');

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('Account is deactivated');
    error.statusCode = 403;
    throw error;
  }

  return toAuthUserProfile(user);
};
