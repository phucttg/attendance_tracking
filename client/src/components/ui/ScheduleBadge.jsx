import { Badge } from 'flowbite-react';

const SCHEDULE_CONFIG = {
    SHIFT_1: { color: 'info', label: 'Ca 1' },
    SHIFT_2: { color: 'purple', label: 'Ca 2' },
    FLEXIBLE: { color: 'cyan', label: 'Linh hoạt' },
};

export default function ScheduleBadge({ scheduleType }) {
    if (!scheduleType) {
        return <span className="text-gray-400">-</span>;
    }
    const config = SCHEDULE_CONFIG[scheduleType] || { color: 'gray', label: scheduleType };
    return <Badge color={config.color}>{config.label}</Badge>;
}
