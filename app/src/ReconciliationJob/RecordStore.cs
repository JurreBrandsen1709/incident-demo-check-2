using System.Globalization;

namespace ReconciliationJob;

public class RecordStore : IRecordStore
{
    private static readonly string[] AcceptedDateFormats = { "yyyy-MM-dd" };

    private readonly IReadOnlyList<Record> _records;

    public RecordStore(IReadOnlyList<Record> records)
    {
        _records = records;
    }

    public static RecordStore FromCsvFile(string csvPath)
    {
        var lines = File.ReadAllLines(csvPath);
        var records = new List<Record>();
        var skipped = 0;

        foreach (var line in lines.Skip(1)) // header: id,timestampUtc,amount
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            var fields = line.Split(',');
            var timestampUtc = default(DateTime);
            var amount = default(decimal);
            var parsed = fields.Length == 3
                && DateTime.TryParseExact(
                    fields[1], AcceptedDateFormats, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                    out timestampUtc)
                && decimal.TryParse(fields[2], NumberStyles.Number, CultureInfo.InvariantCulture, out amount);

            if (!parsed)
            {
                skipped++;
                continue;
            }

            records.Add(new Record(fields[0], timestampUtc, amount));
        }

        if (skipped > 0)
        {
            Console.Error.WriteLine($"Skipped {skipped} row(s) with an unrecognized date format.");
        }

        return new RecordStore(records);
    }

    public IReadOnlyList<Record> GetRecordsForWindow(DateTime fromUtc, DateTime toUtc)
    {
        return _records
            .Where(r => r.TimestampUtc >= fromUtc && r.TimestampUtc <= toUtc)
            .ToList();
    }
}
