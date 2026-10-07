# Security

FreshWay handles customer accounts, delivery addresses and order information.

## Reporting

Please report suspected security vulnerabilities privately through GitHub's repository security features or another private channel available to the repository owner. Do not publish credentials, session material, customer data or exploit details in a public issue or pull request.

## Secret handling

Production secrets must remain outside the repository. Do not place authentication tokens, session-signing secrets, Web Push private keys or WhatsApp credentials in browser code, commits, logs or test fixtures.

## Customer data

Use test-only customer data in development and CI. Do not copy real customer records into fixtures, screenshots or documentation.
