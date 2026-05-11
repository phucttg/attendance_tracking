import { Label, TextInput } from 'flowbite-react';
import { HiSearch } from 'react-icons/hi';

/**
 * Search input with total count for All Users view.
 * Extracted from AdminMembersPage.jsx lines 390-411.
 * 
 * Features:
 * - Search input with icon
 * - Total users count display with locale formatting
 * - Mobile responsive (full width on mobile, flexible on desktop)
 * - Disabled autocomplete and spellcheck for better UX
 * - 100% bulletproof: safe value handling, i18n-ready number formatting
 * 
 * @param {Object} props
 * @param {string} props.value - Current search query
 * @param {Function} props.onChange - (query: string) => void
 * @param {number} props.totalCount - Total users count
 */
export default function MemberSearchBar({ value, onChange, totalCount }) {
    // Safe value to prevent controlled/uncontrolled warning
    const safeValue = value ?? '';

    // Format number with locale (e.g., 1,234) for better readability
    const displayTotal = Number.isFinite(totalCount)
        ? totalCount.toLocaleString('en-US')
        : '0';

    return (
        <div className="mb-4 flex flex-wrap gap-4 items-end">
            {/* Search Input: Full width on mobile, flexible on desktop */}
            <div className="w-full sm:flex-1 sm:max-w-md min-w-0">
                <Label htmlFor="member-search" value="Tìm kiếm" className="mb-1 block" />
                <TextInput
                    id="member-search"
                    type="text"
                    icon={HiSearch}
                    placeholder="Tên, email hoặc mã nhân viên..."
                    value={safeValue}
                    onChange={(e) => onChange(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>

            {/* Total Count: No wrap to prevent awkward line breaks */}
            <div className="text-sm text-gray-500 pb-2 whitespace-nowrap">
                Tổng: {displayTotal} nhân viên
            </div>
        </div>
    );
}
