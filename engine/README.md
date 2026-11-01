# engine

The MailOps engine: a Google Apps Script **library** that runs in each user's own Google account and does all the Gmail work: archiving, moving to Trash, labels and filters. It pulls rules and approved commands from the MailOps API and reports runs back.

It is ported from a production single-user version in milestone **M3**. It follows the same safety model:

- dry run by default
- move to Trash, never permanent delete
- starred, Important and `Keep`-labelled mail is never touched
- resumable, quota-aware batches.

`engine-template/` (also M3) is the small script users copy; it calls this library.
