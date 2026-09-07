cronAdd("cleanup_sessions", "*/1 * * * *", () => {
    try {
        const fifteenHoursAgo = new Date(Date.now() - 15 * 60 * 60 * 1000);
        const dateStr = fifteenHoursAgo.toISOString().replace("T", " ").substring(0, 19) + "Z";
        
        console.log("CRON: Running session cleanup for older than", dateStr);
        const records = $app.findAllRecords("sessions", $dbx.exp("created < {:date}", { date: dateStr }));
        
        let deleted = 0;
        for (let record of records) {
            $app.delete(record);
            deleted++;
        }
        if (deleted > 0) {
            console.log(`CRON: Deleted ${deleted} old sessions.`);
        }
    } catch(err) {
        console.error("CRON ERROR:", err);
    }
});
