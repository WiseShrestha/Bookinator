-- The engine now asks up to 40 questions (src/engine/config.ts maxQuestions), like Akinator's long games.
-- submit_game_session rejects games with more answers than this setting, so it must follow the engine.
update public.community_settings set value = '40', updated_at = now() where key = 'max_session_answers';
