import { REST, Routes, DiscordAPIError } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './commands/index.js';

const commands = [...(await loadCommands()).values()].map((c) => c.data.toJSON());

const rest = new REST().setToken(config.discord.token);

console.log(
  `Registering ${commands.length} guild command(s) for app ${config.discord.clientId} in guild ${config.discord.guildId}…`,
);

try {
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands },
  );
  console.log('Done:', commands.map((c) => `/${c.name}`).join(' '));
} catch (err) {
  if (err instanceof DiscordAPIError) {
    console.error(`\n❌ Discord rejected the request: ${err.message} (code ${err.code})`);
    if (err.code === 10002) {
      console.error(
        'Unknown Application — DISCORD_CLIENT_ID does not match a real application.\n' +
          'Copy it from Developer Portal → your app → General Information → Application ID.\n' +
          'The token and the client ID must belong to the SAME application.',
      );
    } else if (err.status === 401) {
      console.error('Unauthorized — DISCORD_TOKEN is wrong or was reset.');
    } else if (err.code === 50001) {
      console.error(
        'Missing Access — the bot is not in that guild, or was invited without the ' +
          'applications.commands scope. Re-invite it with the URL in the README.',
      );
    }
  } else {
    console.error('\n❌ Unexpected error:', err);
  }
  process.exitCode = 1;
}
