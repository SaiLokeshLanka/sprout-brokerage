/** Today's date in India (IST), YYYY-MM-DD — the server's reports use IST calendar days. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
