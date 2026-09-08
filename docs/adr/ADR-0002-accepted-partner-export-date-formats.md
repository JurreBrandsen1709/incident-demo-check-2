keywords: [date, format, partner, export, parse, accepted-formats, csv]

# ADR-0002: Accepted partner-export date formats live in one place

## Status
Accepted

## Context
The nightly reconciliation job ingests a CSV export from an upstream partner
(ACME). Partners can and do change the shape of their export without notice —
in particular, the date format of the `timestampUtc` column. A row whose date
doesn't match a known format should not crash the job; it should be treated as
unparseable and excluded from that run's processed count, so a partner-side
format change degrades to a low/zero `records_processed` count rather than an
outage.

## Decision
`RecordStore.AcceptedDateFormats` (`app/src/ReconciliationJob/RecordStore.cs`)
is the single, exhaustive list of date formats the ingest job will parse.
Adding support for a new partner-side format means adding one entry to this
array — nothing else in the ingest path should need to change.

## Consequences
If `records_processed` drops sharply with no exception and no other evidence
of a code or infrastructure change, check whether the partner's export date
format has drifted out of `AcceptedDateFormats` before assuming a code defect.
