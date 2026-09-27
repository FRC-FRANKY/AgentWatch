# Troubleshooting

## Common issues

### The app will not start

- Ensure all required environment variables are set in the local environment.
- Check that PostgreSQL and Redis are running.
- Confirm the backend `.env` values match your local database credentials.

### Login fails

- Verify the email and password are correct.
- Check whether MFA is required for the user role.
- Review rate-limiting and lockout conditions.

### Monitoring requests fail

- Verify the manager is assigned to the agent in the authorization table.
- Confirm the device is registered and online.
- Check that the device status is not disabled or offline.

### WebRTC does not connect

- Ensure STUN/TURN values are configured in the environment.
- Check firewall and NAT settings.
- Confirm the agent client is online and authorized for the requested session.
