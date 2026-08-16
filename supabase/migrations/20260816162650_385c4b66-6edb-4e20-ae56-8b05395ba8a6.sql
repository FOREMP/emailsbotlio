
UPDATE sequence_nodes
SET config = jsonb_set(
  config,
  '{subject_prompt}',
  to_jsonb(
    replace(
      replace(
        config->>'subject_prompt',
        'inga VERSALER.',
        'skriv inte hela ord i VERSALER. Använd normal skrivning: stor bokstav i början av raden och företagsnamnet stavat precis som det skrivs normalt (inte enbart gemener).'
      ),
      'no ALL CAPS.',
      'do not write whole words in ALL CAPS. Use normal sentence case: capitalise the first letter and write the company name exactly as it is normally spelled (not all lowercase).'
    )
  )
)
WHERE id IN (
  '71e2623e-9e5c-455f-996c-91567a661734',
  '2687f5cb-26f1-44be-838b-4cd4c635981f',
  '3badd1c7-5033-4673-9f62-a9fc4d500e8a',
  'f0e4dd06-c334-4c6a-b7f8-7980b08948bd',
  '706bf160-a754-464c-a1a5-8e15cc7beaaa',
  '456502a1-d87d-49da-8904-c825a41d853c',
  'bb4e0db5-6dfc-43b3-8264-88d7ea045886',
  'f6907839-42b0-4f44-9ce4-f30670cf8950'
);
