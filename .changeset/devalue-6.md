---
"astro-tanstack-query": patch
---

Accept devalue 6 as the optional `serializer: "devalue"` peer, alongside devalue 5. The package only
uses devalue's `parse` and `stringify`, which version 6 did not change; the end-to-end suite now runs
against it. devalue 6 itself requires Node 22.17 or newer.
