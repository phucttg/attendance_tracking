export const TIMEZONE = 'Asia/Ho_Chi_Minh';

export const getCurrentMonth = () => {
    const now = new Date();
    const gmt7 = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    return `${gmt7.getFullYear()}-${String(gmt7.getMonth() + 1).padStart(2, '0')}`;
};

export const formatTime = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleTimeString('vi-VN', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const safe = String(dateStr).split('T')[0];
    const [year, month, day] = safe.split('-');
    return `${day}/${month}/${year}`;
};

export const formatMinutes = (minutes) => {
    if (minutes === null || minutes === undefined) return '-';
    if (typeof minutes !== 'number' || Number.isNaN(minutes) || minutes < 0) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

export const formatDurationByMode = (minutes, mode = 'minutes') => {
    if (minutes === null || minutes === undefined) return '-';
    if (typeof minutes !== 'number' || Number.isNaN(minutes) || minutes < 0) return '-';

    const normalizedMinutes = Math.floor(minutes);

    if (mode === 'hours') {
        const hours = Math.floor(normalizedMinutes / 60);
        const mins = normalizedMinutes % 60;
        return `${hours}h ${mins}m`;
    }

    return `${normalizedMinutes} phút`;
};

export const getMonthOptions = (count = 12) => {
    const options = [];
    const now = new Date();
    const gmt7 = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    
    for (let i = 0; i < count; i++) {
        const d = new Date(gmt7.getFullYear(), gmt7.getMonth() - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleString('vi-VN', { month: 'long', year: 'numeric' });
        options.push({ value, label });
    }
    return options;
};
