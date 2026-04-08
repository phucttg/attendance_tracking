# 🕒 Attendance Management System

> A full-stack MERN attendance tracking system designed for SMEs with role-based access control, overtime management, and comprehensive reporting.

[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-9.1-47A248?logo=mongodb)](https://www.mongodb.com/)
[![Vite](https://img.shields.io/badge/Vite-Build%20Tool-646CFF?logo=vite)](https://vitejs.dev/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Running the Application](#-running-the-application)
- [Demo Accounts](#-demo-accounts)
- [Usage Guide](#-usage-guide)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [API Endpoints](#-api-endpoints)
- [Security Features](#-security-features)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 Overview

This attendance management system is an internal tool built for small to medium enterprises (SMEs) to track employee attendance, manage time-off requests, handle overtime approvals, and generate comprehensive monthly reports.

**Key Value Propositions:**
- ✨ **Simple & Intuitive**: Clean UI designed for daily use by employees at all levels
- 🔐 **Role-Based Access Control (RBAC)**: Three-tier permission system (Employee/Manager/Admin)
- ⏰ **Overtime Management**: Built-in OT request and approval workflow with cross-midnight support
- 📊 **Comprehensive Reporting**: Excel export with daily matrix and aggregated metrics
- 🔒 **Security First**: JWT authentication, bcrypt password hashing, formula injection prevention
- 🧪 **Well Tested**: Unit, integration, and E2E tests with Vitest and Playwright

**Perfect for:**
- Companies with 10-500 employees
- HR departments needing basic attendance tracking
- Teams requiring approval workflows for time adjustments
- Organizations transitioning from manual attendance logs

---

## ✨ Features

### 🧑‍💼 For All Users (Employee/Manager/Admin)

- 🔐 **Secure Authentication**: Login with email/username and password using JWT tokens
- ⏱️ **Daily Check-in/Check-out**: Simple one-click attendance tracking
- 📅 **Personal Attendance History**: View monthly attendance with filters
- 🌙 **Cross-Midnight Checkout**: Support for approved overtime sessions extending past midnight
- 📝 **Profile Management**: View and update personal information

### 👤 For Employees

- 📤 **Submit Attendance Adjustments**: Request corrections for forgotten check-ins/check-outs
- ⏰ **Submit OT Requests**: Request overtime approval before working extended hours
- 📍 **Track Request Status**: Monitor pending, approved, and rejected requests
- 📊 **View Personal Stats**: See late minutes, work hours, and OT hours

### 👔 For Managers

- 👥 **Team Attendance View**: Timesheet matrix showing all team members
- ✅ **Approve/Reject Requests**: Review team requests with optional rejection reasons
- 📜 **Approval History**: View past approvals/rejections with filtering
- 📊 **Team Reports**: Generate monthly reports for your team
- 👀 **Real-time Team Status**: See who's currently checked in

### 🔑 For Admins

- 🌐 **Company-Wide Visibility**: Access all attendance records across teams
- 👥 **User Management**: Create, update, and manage all users and teams
- 📊 **Advanced Reporting**: Export detailed Excel reports with:
  - Summary sheet with aggregated metrics
  - Daily detail matrix with color-coded status
  - Late minutes, leave breakdown, OT hours tracking
- 🗓️ **Holiday Management**: Configure company holidays and non-working days
- 🔧 **System Configuration**: Manage teams, roles, and permissions

---

## 🛠 Tech Stack

### Frontend
- **Framework**: React 18.3
- **Build Tool**: Vite
- **Routing**: React Router 7.12
- **UI Library**: Flowbite React + Tailwind CSS
- **HTTP Client**: Axios
- **Icons**: React Icons

### Backend
- **Runtime**: Node.js
- **Framework**: Express 5.2
- **Database**: MongoDB + Mongoose 9.1
- **Authentication**: JWT (jsonwebtoken)
- **Password Hashing**: bcrypt
- **Excel Generation**: ExcelJS
- **CORS**: cors middleware

### Testing
- **Unit/Integration**: Vitest
- **E2E Testing**: Playwright
- **Testing Utilities**: Testing Library, jest-axe
- **API Testing**: Supertest

### DevOps
- **Version Control**: Git
- **CI/CD**: GitHub Actions (Flowbite CSS verification)
- **Code Style**: ESLint
- **Commit Convention**: Conventional Commits

---

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: v18.x or higher ([Download](https://nodejs.org/))
- **npm**: v9.x or higher (comes with Node.js)
- **MongoDB**: v6.0 or higher
  - Local installation ([Download](https://www.mongodb.com/try/download/community)) OR
  - MongoDB Atlas account ([Sign up](https://www.mongodb.com/cloud/atlas))
- **Git**: For cloning the repository

**Check your versions:**
```bash
node -v
npm -v
mongod --version  # if using local MongoDB
```

---

## 🚀 Installation & Setup

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/yourusername/attendance-management-system.git
cd attendance-management-system
```

### 2️⃣ Server Setup

```bash
cd server
npm install
```

**Create `.env` file in the `server/` directory:**

```bash
cp .env.example .env
```

**Configure environment variables** in `server/.env`:

```dotenv
# Server Configuration
PORT=9999

# MongoDB Connection
# For local MongoDB:
MONGO_URI=mongodb://localhost:27017/attendance_db

# For MongoDB Atlas:
# MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/attendance_db

# MongoDB Transaction Support
# Set to 'true' for production with replica set or MongoDB Atlas
# Set to 'false' for standalone local development
MONGODB_REPLICA_SET=false

# JWT Configuration
# IMPORTANT: Change this to a strong random secret in production (min 32 chars)
JWT_SECRET=your_super_secure_jwt_secret_min_32_characters_long_change_in_production
JWT_EXPIRES_IN=7d

# Cross-midnight OT & Request Settings
CHECKOUT_GRACE_HOURS=24      # Max session length (hours)
ADJUST_REQUEST_MAX_DAYS=7    # Max submission window (days from checkIn)
```

**Seed the database** (creates demo users and teams):

```bash
npm run seed
```

**Expected output:**
```
✓ Created team: Engineering
✓ Created users: Admin, Manager, Employee
✓ Seed completed successfully!
```

### 3️⃣ Client Setup

Open a new terminal and navigate to the client directory:

```bash
cd client
npm install
```

**Create `.env` file in the `client/` directory:**

```bash
cp .env.example .env
```

**Configure environment variables** in `client/.env`:

```dotenv
# API Base URL
VITE_API_BASE_URL=http://localhost:9999/api
```

---

## 🏃 Running the Application

### Development Mode

You'll need **two terminal windows**:

**Terminal 1 - Start Backend Server:**
```bash
cd server
npm run dev
```

Expected output:
```
✓ MongoDB Connected
✓ Server running on http://localhost:9999
```

**Terminal 2 - Start Frontend Development Server:**
```bash
cd client
npm run dev
```

Expected output:
```
VITE v5.x.x  ready in 500 ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

**Access the application:**
- 🌐 Frontend: [http://localhost:5173](http://localhost:5173)
- 🔌 Backend API: [http://localhost:9999/api](http://localhost:9999/api)

### Production Mode

**Build the client:**
```bash
cd client
npm run build
```

**Start the server:**
```bash
cd server
NODE_ENV=production npm start
```

**Serve static files** (optional - configure Express to serve `client/dist`):
```javascript
// In server/src/app.js or server.js
app.use(express.static(path.join(__dirname, '../../client/dist')));
```

---

## 👥 Demo Accounts

After running `npm run seed` in the server directory, the following accounts are available:

| Role | Email | Username | Password |
|------|-------|----------|----------|
| 🔑 **Admin** | admin@company.com | admin | Password123 |
| 👔 **Manager** | manager@company.com | manager | Password123 |
| 👤 **Employee** | employee@company.com | employee | Password123 |

**Default Team:** All users belong to the "Engineering" team.

⚠️ **Security Notice**: Change these passwords immediately in production!

---

## 📖 Usage Guide

### 🎬 First-Time Setup

1. **Login as Admin** (`admin@company.com` / `Password123`)
2. Navigate to **Admin Dashboard** or **Members Page**
3. **Create Teams** (if additional teams needed)
4. **Create Users** and assign them to teams
5. **Assign Managers** to their respective teams
6. **Configure Holidays** (optional)

### ⏱️ Daily Attendance Flow

**For Employees:**

1. **Login** to the system
2. **Dashboard** displays current status:
   - `Chưa check-in` (Not checked in)
   - `Đang làm việc` (Working - checked in, not checked out)
   - `Đã check-out` (Checked out)
3. Click **"Check-in"** when arriving at work
4. Click **"Check-out"** when leaving
5. View today's stats: work hours, late minutes, OT hours

### 📝 Request Approval Workflow

**Employee Side:**

1. Go to **"Yêu cầu của tôi"** (My Requests) page
2. Click **"Tạo yêu cầu mới"** (Create new request)
3. Choose request type:
   - **ADJUST_TIME**: Forgot check-in/check-out or wrong time
   - **OT_REQUEST**: Request overtime approval
   - **ANNUAL_LEAVE**: Annual leave request
   - **SICK_LEAVE**: Sick leave request
   - **UNPAID_LEAVE**: Unpaid leave request
4. Fill in required details and submit
5. Track status (PENDING → APPROVED/REJECTED)

**Manager/Admin Side:**

1. Go to **"Duyệt yêu cầu"** (Approvals) page
2. **"Đang chờ"** tab: View pending requests from your team
3. Click **Approve** or **Reject**
4. For rejections: Optionally add a reason (max 500 characters)
5. **"Lịch sử"** tab: View past approvals/rejections
   - Filter by status (APPROVED/REJECTED)
   - See reject reasons if provided

### 📊 Monthly Reports (Admin/Manager)

1. Go to **"Báo cáo"** (Reports) page
2. Select **Month** (YYYY-MM)
3. **(Admin only)** Select **Team** or "All Teams"
4. Click **"Xuất Excel"** (Export Excel)
5. Downloaded file contains:
   - **Summary Sheet**: Aggregated metrics per employee
   - **Daily Matrix**: Day-by-day status with color coding

**Report Metrics:**
- Total workdays, present days, absent days
- Late count and total late minutes
- Early leave count
- Total work hours and approved OT hours
- Leave breakdown (Annual/Sick/Unpaid)

---

## 🧪 Testing

### Client Tests

```bash
cd client

# Run all unit/integration tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage

# Run accessibility tests
npm run test:a11y

# Run E2E tests with Playwright
npm run test:e2e         # Headless mode
npm run test:e2e:ui      # Playwright UI mode
npm run test:e2e:headed  # Headed browser mode
```

### Server Tests

```bash
cd server

# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch
```

### Test Coverage

- **Backend**: Controllers, services, middleware, models
- **Frontend**: Components, hooks, API client, pages
- **E2E**: Complete user flows (auth, attendance, requests, approvals)
- **Accessibility**: WCAG compliance with jest-axe

---

## 📁 Project Structure

```
attendance-management-system/
├── client/                          # React frontend application
│   ├── src/
│   │   ├── api/                    # API client functions (axios)
│   │   │   ├── client.js           # Axios instance with interceptors
│   │   │   ├── authApi.js          # Authentication endpoints
│   │   │   ├── attendanceApi.js    # Attendance endpoints
│   │   │   ├── requestApi.js       # Request endpoints
│   │   │   └── reportApi.js        # Report endpoints
│   │   ├── components/             # Reusable React components
│   │   │   ├── approvals/          # Approval-related components
│   │   │   ├── attendance/         # Attendance tables and forms
│   │   │   ├── dashboard/          # Dashboard widgets
│   │   │   ├── layout/             # Layout components (Navbar, Sidebar)
│   │   │   ├── members/            # User management components
│   │   │   └── requests/           # Request forms and lists
│   │   ├── context/                # React Context providers
│   │   │   └── AuthContext.jsx     # Authentication state management
│   │   ├── hooks/                  # Custom React hooks
│   │   │   ├── usePagination.js    # Pagination logic
│   │   │   └── useAuth.js          # Auth helper hook
│   │   ├── pages/                  # Page components (routes)
│   │   │   ├── Dashboard.jsx       # Main dashboard
│   │   │   ├── LoginPage.jsx       # Login page
│   │   │   ├── AttendancePage.jsx  # Attendance history
│   │   │   ├── RequestsPage.jsx    # My requests
│   │   │   ├── ApprovalsPage.jsx   # Approval queue
│   │   │   ├── ReportsPage.jsx     # Monthly reports
│   │   │   └── MembersPage.jsx     # User management (Admin)
│   │   ├── utils/                  # Utility functions
│   │   │   ├── dateUtils.js        # Date formatting helpers
│   │   │   └── downloadBlob.js     # File download utility
│   │   ├── App.jsx                 # Root component with routing
│   │   └── main.jsx                # Application entry point
│   ├── e2e/                        # Playwright E2E tests
│   │   ├── auth-flow.spec.js
│   │   ├── attendance-flow.spec.js
│   │   ├── ot-request-flow.spec.js
│   │   ├── request-approval-flow.spec.js
│   │   └── cross-midnight-checkout.spec.js
│   ├── tests/                      # Unit and integration tests
│   │   ├── unit/                   # Unit tests
│   │   ├── integration/            # Integration tests
│   │   ├── accessibility/          # Accessibility tests
│   │   └── mocks/                  # Mock data and handlers
│   ├── public/                     # Static assets
│   ├── playwright.config.js        # Playwright configuration
│   ├── vitest.config.js            # Vitest configuration
│   └── vite.config.js              # Vite build configuration
│
├── server/                          # Express backend application
│   ├── src/
│   │   ├── controllers/            # Route handlers (request/response)
│   │   │   ├── authController.js
│   │   │   ├── attendanceController.js
│   │   │   ├── requestController.js
│   │   │   ├── reportController.js
│   │   │   └── userController.js
│   │   ├── models/                 # Mongoose schemas
│   │   │   ├── User.js
│   │   │   ├── Team.js
│   │   │   ├── Attendance.js
│   │   │   ├── Request.js
│   │   │   └── Holiday.js
│   │   ├── routes/                 # API route definitions
│   │   │   ├── authRoutes.js
│   │   │   ├── attendanceRoutes.js
│   │   │   ├── requestRoutes.js
│   │   │   └── reportRoutes.js
│   │   ├── services/               # Business logic layer
│   │   │   ├── authService.js
│   │   │   ├── attendanceService.js
│   │   │   ├── requestService.js
│   │   │   └── reportService.js
│   │   ├── middleware/             # Express middleware
│   │   │   ├── authenticate.js     # JWT verification
│   │   │   ├── authorize.js        # RBAC permission checks
│   │   │   └── errorHandler.js     # Global error handling
│   │   ├── utils/                  # Utility functions
│   │   │   ├── dateUtils.js
│   │   │   └── sanitizeForExcel.js # Excel injection prevention
│   │   ├── seeds/                  # Database seed scripts
│   │   │   └── seedData.js         # Create demo users/teams
│   │   ├── app.js                  # Express app configuration
│   │   └── server.js               # Server entry point
│   ├── tests/                      # Server-side tests
│   │   ├── auth.test.js
│   │   ├── attendance.test.js
│   │   ├── request.test.js
│   │   └── approval-history.test.js
│   ├── vitest.config.js            # Vitest configuration
│   └── package.json
│
├── docs/                            # Documentation
│   ├── mvp_scope.md                # MVP feature specifications
│   ├── data_dictionary.md          # Database schema documentation
│   ├── rules.md                    # Business logic rules
│   ├── conventional-commits-cheatsheet.md
│   └── flowbite-component-mapping.md
│
├── .github/                         # GitHub configuration
│   ├── workflows/
│   │   └── client-flowbite-css.yml # CI workflow
│   └── instructions/               # Copilot instructions
│
└── README.md                        # This file
```

---

## 🔌 API Endpoints

### Authentication
```
POST   /api/auth/login              # Login with email/username + password
GET    /api/auth/me                 # Get current user profile (JWT required)
```

### Attendance
```
GET    /api/attendance/me           # Get user's monthly attendance
GET    /api/attendance/open-session # Check for open cross-midnight sessions
POST   /api/attendance/check-in     # Check-in for today
POST   /api/attendance/check-out    # Check-out for today
GET    /api/attendance/today-stats  # Today's work stats
```

### Requests
```
GET    /api/requests/me             # Get user's own requests (paginated)
POST   /api/requests                # Create new request (ADJUST_TIME, OT_REQUEST, LEAVE)
GET    /api/requests/pending        # Get pending approvals (MANAGER/ADMIN)
GET    /api/requests/history        # Get approval history (MANAGER/ADMIN)
POST   /api/requests/:id/approve    # Approve request (MANAGER/ADMIN)
POST   /api/requests/:id/reject     # Reject request with optional reason (MANAGER/ADMIN)
DELETE /api/requests/:id            # Cancel own request (PENDING only)
```

### Reports
```
GET    /api/reports/monthly         # Get monthly report data
GET    /api/reports/monthly/export  # Export monthly report to Excel
GET    /api/reports/timesheet       # Get timesheet matrix for team/company
```

### Admin - Users & Teams
```
GET    /api/users                   # List all users (ADMIN)
POST   /api/users                   # Create new user (ADMIN)
PUT    /api/users/:id               # Update user (ADMIN)
DELETE /api/users/:id               # Soft-delete user (ADMIN)

GET    /api/teams                   # List all teams
POST   /api/teams                   # Create team (ADMIN)
```

**Authentication**: All endpoints except `/api/auth/login` require JWT token in `Authorization: Bearer <token>` header.

**RBAC**: Endpoints marked with role restrictions enforce authorization via middleware.

---

## 🔒 Security Features

This application implements multiple layers of security:

### Authentication & Authorization
- ✅ **JWT-based authentication** with configurable expiration
- ✅ **Password hashing** using bcrypt (SALT_ROUNDS=10)
- ✅ **Role-Based Access Control (RBAC)** with three tiers (EMPLOYEE, MANAGER, ADMIN)
- ✅ **Token validation** on every protected route
- ✅ Passwords **never returned** in API responses

### Data Protection
- ✅ **MongoDB injection prevention** via Mongoose schema validation
- ✅ **Excel formula injection prevention** with `sanitizeForExcel()` utility
- ✅ **Input validation** for all request payloads
- ✅ **Soft delete** for user records (audit trail preservation)

### Network Security
- ✅ **CORS configuration** to restrict cross-origin requests
- ✅ **Environment variable isolation** (secrets not committed)
- ✅ **Secure session handling** with JWT expiration

### OWASP Compliance
- ✅ **CSV/Excel Injection (OWASP)**: Leading `=`, `+`, `-`, `@` characters escaped
- ✅ **Blob API downloads**: No `window.open()` XSS vulnerability
- ✅ **XSS prevention**: React's built-in escaping
- ✅ **CSRF protection**: JWT tokens (not cookies)

### Best Practices
- ✅ **Separate concerns**: Controllers, services, and data layers
- ✅ **Error handling**: Centralized error middleware
- ✅ **Logging**: Operation audit trail (approvals, rejections)
- ✅ **Transaction support**: MongoDB replica set for atomic operations (production)

---

## 🐛 Troubleshooting

### MongoDB Connection Failures

**Problem**: `MongooseServerSelectionError: connect ECONNREFUSED`

**Solutions**:
1. Ensure MongoDB is running:
   ```bash
   # macOS (Homebrew)
   brew services start mongodb-community
   
   # Windows
   net start MongoDB
   
   # Linux
   sudo systemctl start mongod
   ```
2. Check `MONGO_URI` in `server/.env` matches your MongoDB connection string
3. For MongoDB Atlas, ensure:
   - IP whitelist includes your IP address
   - Username/password are correctly encoded

### Port Already in Use

**Problem**: `Error: listen EADDRINUSE: address already in use :::9999`

**Solutions**:
```bash
# Find process using port 9999
lsof -i :9999    # macOS/Linux
netstat -ano | findstr :9999  # Windows

# Kill the process
kill -9 <PID>    # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Or change PORT in server/.env
PORT=9999
```

### CORS Errors

**Problem**: `Access to XMLHttpRequest blocked by CORS policy`

**Solutions**:
1. Verify `VITE_API_BASE_URL` in `client/.env` matches backend URL
2. Check CORS configuration in `server/src/app.js`
3. Ensure backend is running before starting frontend

### JWT Token Expiration

**Problem**: Suddenly logged out or "Unauthorized" errors

**Solutions**:
1. JWT tokens expire after `JWT_EXPIRES_IN` (default: 7 days)
2. Re-login to get a new token
3. For development, increase `JWT_EXPIRES_IN=30d` in `server/.env`

### Build Errors

**Problem**: `npm run build` fails

**Solutions**:
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf client/.vite

# Check Node.js version
node -v  # Should be v18+ for Vite
```

### Seed Data Issues

**Problem**: Seed script fails or creates duplicates

**Solutions**:
```bash
# Clear database and re-seed
mongo attendance_db --eval "db.dropDatabase()"
cd server
npm run seed
```

---

## 🤝 Contributing

Contributions are welcome! This project follows the **Conventional Commits** specification for commit messages.

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature for the user
- `fix`: Bug fix
- `refactor`: Code restructuring without behavior change
- `style`: Code style changes (formatting, missing semi-colons)
- `test`: Adding or updating tests
- `docs`: Documentation changes
- `build`: Build system or dependency changes
- `chore`: Maintenance tasks

**Examples**:
```bash
feat(client): add approval history tab to ApprovalsPage
fix(server): correct timezone calculation for cross-midnight checkout
test(client): add E2E test for OT request flow
docs: update installation instructions for MongoDB Atlas
```

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `npm run test`
5. Commit with conventional commits: `git commit -m "feat: add my feature"`
6. Push to your fork: `git push origin feat/my-feature`
7. Open a Pull Request

**Before submitting PR**:
- ✅ All tests pass (`npm run test`)
- ✅ Code follows existing style patterns
- ✅ Conventional commit format used
- ✅ Documentation updated (if needed)

---

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 📞 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/attendance-management-system/issues)
- **Documentation**: See `/docs` folder for detailed specifications
- **Email**: your.email@example.com

---

## 🙏 Acknowledgments

**Built With:**
- [React](https://reactjs.org/) - Frontend framework
- [Express](https://expressjs.com/) - Backend framework
- [MongoDB](https://www.mongodb.com/) - Database
- [Flowbite React](https://flowbite-react.com/) - UI components
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Vite](https://vitejs.dev/) - Build tool
- [Vitest](https://vitest.dev/) - Testing framework
- [Playwright](https://playwright.dev/) - E2E testing

**Special Thanks:**
- OWASP for security guidelines
- Conventional Commits specification
- Open source community

---

<div align="center">

**⭐ If this project helps you, give it a star!**

Made with ❤️ for SME attendance management

[Report Bug](https://github.com/yourusername/attendance-management-system/issues) · [Request Feature](https://github.com/yourusername/attendance-management-system/issues) · [View Demo](https://your-demo-url.com)

</div>
