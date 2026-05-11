# Flowbite React Component Mapping — Attendance MVP

> Tài liệu này map các Flowbite React components với từng page của ứng dụng.
> Chỉ sử dụng components **FREE** từ `flowbite-react` library.

---

## 📦 Flowbite React Components (FREE - từ npm package)

| Component | Import | Dùng cho |
|-----------|--------|----------|
| `Navbar` | `flowbite-react` | App header |
| `Sidebar` | `flowbite-react` | Navigation menu |
| `Button` | `flowbite-react` | Actions (check-in, approve, export) |
| `TextInput` | `flowbite-react` | Form inputs |
| `Label` | `flowbite-react` | Form labels |
| `Textarea` | `flowbite-react` | Reason input |
| `Select` | `flowbite-react` | Month/scope selectors |
| `Table` | `flowbite-react` | Data tables |
| `Badge` | `flowbite-react` | Status badges |
| `Modal` | `flowbite-react` | Confirm dialogs |
| `Alert` | `flowbite-react` | Error/success messages |
| `Spinner` | `flowbite-react` | Loading states |
| `Card` | `flowbite-react` | Container wrappers |
| `Toast` | `flowbite-react` | Success notifications |
| `Datepicker` | `flowbite-react` | Date selection |

---

## 🔗 Flowbite Blocks References (cho design inspiration)

> **Lưu ý:** Flowbite Blocks là **HTML templates** (một số premium). Chúng ta sẽ dùng **Flowbite React components** để build tương tự.

### Login Page
- **Block ref:** `flowbite.com/blocks/marketing/login/` (có FREE examples)
- **Components:** `Card`, `Label`, `TextInput`, `Button`, `Alert`

### App Layout (Dashboard Shell)
- **Block ref:** `flowbite.com/blocks/application/shells/`
- **Components:** `Navbar`, `Sidebar`, `Sidebar.Item`, `Sidebar.ItemGroup`
- **Note:** Dùng Flowbite React Sidebar thay vì HTML template

### Tables (Attendance, Requests, Reports)
- **Block ref:** `flowbite.com/blocks/application/table-headers/`
- **Block ref:** `flowbite.com/blocks/application/advanced-tables/`
- **Components:** `Table`, `Table.Head`, `Table.Body`, `Table.Row`, `Table.Cell`, `Badge`

### Forms (Create Request)
- **Block ref:** `flowbite.com/blocks/application/crud-create-forms/`
- **Components:** `Label`, `TextInput`, `Textarea`, `Select`, `Datepicker`, `Button`

### Modals (Approve/Reject Confirm)
- **Block ref:** `flowbite.com/blocks/application/crud-delete-confirm/`
- **Components:** `Modal`, `Modal.Header`, `Modal.Body`, `Modal.Footer`, `Button`

### Filters (Scope/Status)
- **Block ref:** `flowbite.com/blocks/application/filter/`
- **Components:** `Select`, `Button` (filter toggle)

---

## 📄 Page → Component Mapping

### 1. LoginPage
```jsx
import { Card, Label, TextInput, Button, Alert, Spinner } from "flowbite-react";
```
- `Card` - container
- `TextInput` - identifier, password
- `Button` - submit
- `Alert` - error message
- `Spinner` - loading state

### 2. Layout (App Shell)
```jsx
import { Navbar, Sidebar, Avatar, Dropdown } from "flowbite-react";
```
- `Navbar` - top bar với logo, user dropdown
- `Sidebar` - navigation menu (role-based items)
- `Dropdown` - user menu (logout)

### 3. DashboardPage
```jsx
import { Card, Button, Badge, Spinner } from "flowbite-react";
```
- `Card` - today status card
- `Button` - check-in/out
- `Badge` - status display
- `Spinner` - loading

### 4. MyAttendancePage
```jsx
import { Table, Badge, Select, Spinner, Alert } from "flowbite-react";
```
- `Select` - month picker
- `Table` - attendance list
- `Badge` - status (ON_TIME=green, LATE=red, etc.)

### 5. RequestsPage
```jsx
import { Card, Label, TextInput, Textarea, Button, Table, Badge, Alert, Datepicker } from "flowbite-react";
```
- Form section: `Label`, `TextInput`, `Datepicker`, `Textarea`, `Button`
- List section: `Table`, `Badge`

### 6. ApprovalsPage (Manager/Admin)
```jsx
import { Table, Badge, Button, Modal, Spinner, Alert } from "flowbite-react";
```
- `Table` - pending requests
- `Button` - approve/reject
- `Modal` - confirm action (NEW v2.7: displays contextual details)
  - OT requests: shows actual check-in/check-out times alongside requested times
  - ADJUST_TIME requests: shows requested times
  - LEAVE requests: shows date range and working days count
  - All times formatted in Vietnamese locale with GMT+7 timezone

### 7. TimesheetMatrixPage (Manager/Admin)
```jsx
import { Table, Select, Badge, Spinner } from "flowbite-react";
```
- `Select` - month, scope selector
- `Table` - matrix (rows=employees, cols=days)
- Custom colored cells (Tailwind bg classes)

### 8. MonthlyReportPage (Manager/Admin)
```jsx
import { Table, Select, Button, Spinner, Alert } from "flowbite-react";
```
- `Select` - month, scope
- `Table` - summary
- `Button` - export (triggers download)

### 9. ProfilePage (NEW v2.2)
```jsx
import { Card, Spinner } from "flowbite-react";
```
- `Card` - user profile container
- `Spinner` - loading state

### 10. AdminHolidaysPage (NEW v2.3)
```jsx
import { Table, Button, Label, TextInput, Datepicker, Modal, Alert, Spinner } from "flowbite-react";
```
- `Table` - holiday list
- `Datepicker` - date/range picker
- `TextInput` - holiday name
- `Button` - create/delete
- `Modal` - confirm action

### 11. AdminMemberDetailPage (NEW v2.2)
```jsx
import { Card, Table, Badge, Select, Spinner, Alert } from "flowbite-react";
```
- `Card` - user profile
- `Table` - monthly attendance table
- `Select` - month picker
- `Badge` - status display

### 12. TeamMemberDetailPage (NEW v2.2)
```jsx
import { Card, Table, Badge, Select, Spinner, Alert } from "flowbite-react";
```
- `Card` - user profile (read-only)
- `Table` - monthly attendance table
- `Select` - month picker
- `Badge` - status display

---

## ⚠️ Không cần từ Flowbite Blocks (Premium)

| Feature | Thay thế |
|---------|----------|
| Complex navbar templates | Dùng `Navbar` component cơ bản |
| Advanced sidebar layouts | Dùng `Sidebar` component cơ bản |
| Premium table designs | Dùng `Table` + custom Tailwind classes |

---

## ✅ Kết luận

**Tất cả components cần thiết đều có trong `flowbite-react` (FREE).**  
Không cần mua Flowbite Blocks premium.

```bash
npm install flowbite-react
# Đã cài xong ✅
```
