-- Display history only. Goer's fenced command journal remains authoritative
-- for reasoning and cart retries; historical cards never execute mutations.
CREATE TABLE public.goer_conversations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id)
);

CREATE INDEX goer_conversations_owner_activity
    ON public.goer_conversations (user_id, updated_at DESC, id DESC);

CREATE TABLE public.goer_history_turns (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (conversation_id, user_id)
        REFERENCES public.goer_conversations(id, user_id) ON DELETE CASCADE,
    UNIQUE (conversation_id, request_id)
);

ALTER TABLE public.goer_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goer_history_turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY goer_conversations_owned_read ON public.goer_conversations
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY goer_history_owned_read ON public.goer_history_turns
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.goer_conversations, public.goer_history_turns FROM anon, authenticated;
GRANT SELECT ON public.goer_conversations, public.goer_history_turns TO authenticated;
GRANT ALL ON public.goer_conversations, public.goer_history_turns TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.goer_history_turns_sequence_seq TO service_role;

CREATE FUNCTION public.save_goer_history_turn(
    p_conversation_id uuid, p_request_id uuid, p_message text, p_response jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    owner_id uuid := auth.uid();
    existing public.goer_history_turns;
BEGIN
    IF owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_conversation_id IS NULL OR p_request_id IS NULL
        OR p_message IS NULL OR char_length(btrim(p_message)) NOT BETWEEN 1 AND 4000
        OR p_response IS NULL OR jsonb_typeof(p_response) IS DISTINCT FROM 'object'
        OR char_length(p_response::text) > 100000
        OR p_response->>'conversation_id' IS DISTINCT FROM p_conversation_id::text
        OR p_response->>'turn_id' IS DISTINCT FROM p_request_id::text
        OR jsonb_typeof(p_response->'text') IS DISTINCT FROM 'string'
        OR char_length(p_response->>'text') > 8000
        OR jsonb_typeof(p_response->'cards') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid history turn' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.goer_conversations (id, user_id, title)
        VALUES (p_conversation_id, owner_id, left(p_message, 80))
        ON CONFLICT (id) DO NOTHING;
    PERFORM 1 FROM public.goer_conversations
        WHERE id = p_conversation_id AND user_id = owner_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO existing FROM public.goer_history_turns
        WHERE conversation_id = p_conversation_id AND request_id = p_request_id;
    IF FOUND THEN
        IF existing.message IS DISTINCT FROM p_message OR existing.response IS DISTINCT FROM p_response THEN
            RAISE EXCEPTION 'History request already has different content' USING ERRCODE = '23505';
        END IF;
        RETURN;
    END IF;
    INSERT INTO public.goer_history_turns (conversation_id, user_id, request_id, message, response)
        VALUES (p_conversation_id, owner_id, p_request_id, p_message, p_response);
    UPDATE public.goer_conversations SET updated_at = clock_timestamp()
        WHERE id = p_conversation_id AND user_id = owner_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_goer_history_turn(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_goer_history_turn(uuid, uuid, text, jsonb) TO authenticated;
