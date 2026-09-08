using System.Globalization;
using ReconciliationJob;

if (args.Length < 3)
{
    Console.Error.WriteLine("Usage: dotnet run --project app/src/ReconciliationJob -- <fixturePath> <fromUtcIso> <toUtcIso>");
    return 1;
}

var fixturePath = args[0];

try
{
    var fromUtc = DateTime.Parse(args[1], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
    var toUtc = DateTime.Parse(args[2], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    if (fromUtc > toUtc)
    {
        Console.Error.WriteLine("fromUtc must not be after toUtc");
        return 1;
    }

    Console.WriteLine($"Reconciliation report for window {fromUtc:yyyy-MM-dd HH:mm} UTC to {toUtc:yyyy-MM-dd HH:mm} UTC");

    IRecordStore store = RecordStore.FromCsvFile(fixturePath);
    var records = store.GetRecordsForWindow(fromUtc, toUtc);

    Console.WriteLine($"records_processed: {records.Count}");
    return 0;
}
catch (Exception ex) when (ex is FormatException or IOException or UnauthorizedAccessException)
{
    Console.Error.WriteLine($"Failed to process reconciliation batch: {ex.Message}");
    return 2;
}
