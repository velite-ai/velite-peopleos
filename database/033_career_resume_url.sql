-- The careers form on the Wix website lets people upload a resume; Wix keeps the file and sends a link, which is stored here as text only.
ALTER TABLE career_applications ADD COLUMN resume_url text;
