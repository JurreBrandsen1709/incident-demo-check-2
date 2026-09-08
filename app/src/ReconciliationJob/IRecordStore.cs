namespace ReconciliationJob;

public interface IRecordStore
{
    IReadOnlyList<Record> GetRecordsForWindow(DateTime fromUtc, DateTime toUtc);
}
