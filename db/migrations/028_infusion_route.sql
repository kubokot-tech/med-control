-- 028_infusion_route.sql
-- Route of administration per session (defaults from the agent): в/в капельно, в/в струйно, в/м, п/к, другое.
alter table infusion_sessions add column if not exists route text;
update infusion_sessions s set route = a.route from infusion_agents a where a.id = s.agent_id and s.route is null;
