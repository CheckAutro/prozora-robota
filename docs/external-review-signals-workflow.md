# External Review Signals Workflow

`external_review_signals` is a separate layer for short admin-verified summaries
of what external reviews appear to say. It is not `public.reviews`, not
`external_ratings`, and not `company_open_facts`.

Bulk workflow:

1. Collect source links by `company_slug`.
2. Prepare CSV summaries manually. Do not paste copied reviews.
3. Import rows as `needs_verification` and `is_public=false`.
4. Admin verifies each summary and source link.
5. Only `status=verified` and `is_public=true` rows appear publicly.

Do not run automated mass scraping, bypass login, captcha, anti-bot systems, or
publish unverified summaries.
