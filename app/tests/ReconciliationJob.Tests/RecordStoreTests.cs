using ReconciliationJob;
using Xunit;

namespace ReconciliationJob.Tests;

public class RecordStoreTests
{
    private static string FixturePath(string fileName) =>
        Path.Combine(AppContext.BaseDirectory, "fixtures", fileName);

    private static DateTime Utc(int year, int month, int day) =>
        new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void FromCsvFile_GoodFixture_ProcessesAllRows()
    {
        var store = RecordStore.FromCsvFile(FixturePath("partner-export-good.csv"));

        var result = store.GetRecordsForWindow(Utc(2026, 1, 1), Utc(2026, 1, 6));

        Assert.Equal(5, result.Count);
    }

    [Fact]
    public void FromCsvFile_BadFixture_SilentlyFiltersAllRows()
    {
        var store = RecordStore.FromCsvFile(FixturePath("partner-export-bad.csv"));

        var result = store.GetRecordsForWindow(Utc(2026, 1, 1), Utc(2026, 1, 6));

        Assert.Empty(result);
    }
}
