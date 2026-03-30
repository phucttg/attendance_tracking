import { useState, useEffect, useMemo, useRef } from 'react';
import { Navbar, Sidebar, Dropdown, Avatar } from 'flowbite-react';
import { Outlet, NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HiHome, HiClock, HiDocumentText, HiCheckCircle, HiTable, HiChartBar, HiUsers, HiUserGroup, HiClipboardCheck, HiUser, HiCalendar } from 'react-icons/hi';
import { safeGetItem, safeSetItem } from '../utils/storage';

/**
 * Layout component: Main app layout with Navbar and Sidebar.
 * - Navbar: Logo + user dropdown (name, role, logout)
 * - Sidebar: Role-based navigation items
 * - Main content: Renders child routes via Outlet
 */
export default function Layout() {
    const { user, loading, logout } = useAuth();
    const location = useLocation();

    // Track if user manually toggled collapse (prevents auto-reopen loop)
    const userToggledRef = useRef(false);

    // Section 1: Personal workspace (all users)
    const personalNavItems = [
        { to: '/dashboard', label: 'Dashboard', icon: HiHome, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
        { to: '/my-attendance', label: 'My Attendance', icon: HiClock, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
        { to: '/my-schedule', label: 'My Schedule', icon: HiCalendar, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
        { to: '/requests', label: 'Requests', icon: HiDocumentText, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
        { to: '/profile', label: 'Profile', icon: HiUser, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
    ];

    // Section 2: Management tools (manager/admin only)
    // Memoized to prevent unnecessary re-renders in useEffect
    const managementNavItems = useMemo(() => [
        { to: '/approvals', label: 'Approvals', icon: HiCheckCircle, roles: ['MANAGER', 'ADMIN'] },
        { to: '/timesheet', label: 'Timesheet', icon: HiTable, roles: ['MANAGER', 'ADMIN'] },
        { to: '/reports', label: 'Reports', icon: HiChartBar, roles: ['MANAGER', 'ADMIN'] },
        { to: '/team/members', label: 'Team Members', icon: HiUsers, roles: ['MANAGER'] },
        { to: '/admin/members', label: 'Members', icon: HiUserGroup, roles: ['ADMIN'] },
        { to: '/admin/holidays', label: 'Holidays', icon: HiCalendar, roles: ['ADMIN'] },
    ], []);

    // Check if current route is a management page (for auto-expand logic)
    const isOnManagementPage = useMemo(() => {
        const managementPaths = managementNavItems.map(item => item.to);
        // Match exact path or sub-routes (e.g., /admin/members matches /admin/members/123)
        return managementPaths.some(path => {
            const pattern = new RegExp(`^${path}(/|$)`);
            return pattern.test(location.pathname);
        });
    }, [location.pathname, managementNavItems]);

    // Auto-expand on first load if on management page
    const [isManagementOpen, setIsManagementOpen] = useState(() => {
        // Initialize from localStorage (default: true for first-time users)
        const savedState = safeGetItem('sidebar-management-open', 'true');
        const savedIsOpen = savedState === 'true';
        
        // If saved state is closed but we're on management page, open it
        // (This handles first navigation to management route)
        if (!savedIsOpen && managementNavItems.some(item => {
            const pattern = new RegExp(`^${item.to}(/|$)`);
            return pattern.test(window.location.pathname);
        })) {
            return true;
        }
        
        return savedIsOpen;
    });

    // Filter navigation items based on user role
    const personalItems = personalNavItems.filter((item) => item.roles.includes(user?.role));
    const managementItems = managementNavItems.filter((item) => item.roles.includes(user?.role));

    // Toggle handler with localStorage persistence
    const toggleManagement = (e) => {
        // Prevent accidental toggle when clicking on navigation items inside collapse
        // Only toggle when clicking the collapse header/chevron itself
        if (e && e.target.closest('.sidebar-item')) {
            return; // Click came from nested item, ignore
        }
        
        userToggledRef.current = true; // Mark as user action
        setIsManagementOpen(prevState => {
            const newState = !prevState;
            safeSetItem('sidebar-management-open', String(newState));
            return newState;
        });
    };

    // Auto-expand Management section when navigating to management routes
    // Only auto-expands if user hasn't manually toggled recently
    useEffect(() => {
        // Reset toggle flag when leaving management routes
        // This allows auto-expand to work again when returning to management section
        if (!isOnManagementPage && userToggledRef.current) {
            userToggledRef.current = false;
        }

        // Skip auto-expand if user has manually toggled while on management page
        if (userToggledRef.current) return;

        // If on management page and currently closed, auto-expand
        if (isOnManagementPage && !isManagementOpen) {
            // Use queueMicrotask to avoid setState-in-effect warning
            queueMicrotask(() => {
                setIsManagementOpen(true);
                safeSetItem('sidebar-management-open', 'true');
            });
        }
    }, [isOnManagementPage, isManagementOpen]);

    // Show loading state while AuthContext is fetching user
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top Navbar */}
            <Navbar fluid className="border-b">
                <Navbar.Brand as={Link} to="/dashboard">
                    <HiClipboardCheck className="mr-2 h-6 w-6 text-primary-600" />
                    <span className="text-xl font-bold text-gray-900">Attendance</span>
                </Navbar.Brand>
                <div className="flex md:order-2">
                    <Dropdown
                        inline
                        label={<Avatar alt={user?.name} rounded />}
                    >
                        <Dropdown.Header>
                            <span className="block text-sm font-medium">{user?.name}</span>
                            <span className="block text-sm text-gray-500">{user?.role}</span>
                        </Dropdown.Header>
                        <Dropdown.Item onClick={logout}>Logout</Dropdown.Item>
                    </Dropdown>
                </div>
            </Navbar>

            <div className="flex">
                {/* Left Sidebar */}
                <Sidebar className="h-[calc(100vh-65px)] w-64 border-r border-gray-200">
                    <Sidebar.Items>
                        {/* Personal workspace section */}
                        <Sidebar.ItemGroup>
                            {personalItems.map((item) => (
                                <Sidebar.Item
                                    key={item.to}
                                    as={NavLink}
                                    to={item.to}
                                    icon={item.icon}
                                >
                                    {item.label}
                                </Sidebar.Item>
                            ))}
                        </Sidebar.ItemGroup>

                        {/* Management section (collapsible, only if user has management items) */}
                        {managementItems.length > 0 && (
                            <Sidebar.ItemGroup>
                                <Sidebar.Collapse 
                                    label="Management" 
                                    open={isManagementOpen}
                                    onClick={toggleManagement}
                                >
                                    {managementItems.map((item) => (
                                        <Sidebar.Item
                                            key={item.to}
                                            as={NavLink}
                                            to={item.to}
                                            icon={item.icon}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {item.label}
                                        </Sidebar.Item>
                                    ))}
                                </Sidebar.Collapse>
                            </Sidebar.ItemGroup>
                        )}
                    </Sidebar.Items>
                </Sidebar>

                {/* Main Content Area */}
                <main className="flex-1 p-6 overflow-auto">
                    <div className="max-w-7xl mx-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
