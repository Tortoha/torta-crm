--
-- PostgreSQL database dump
--

-- psql-only directives stripped (\restrict, \unrestrict) — would error via cursor.execute()

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: log_l2_stock_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."log_l2_stock_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
                DECLARE
                    v_project_id INTEGER;
                    v_skip TEXT;
                BEGIN
                    BEGIN
                        v_skip := current_setting('torta.skip_audit', true);
                    EXCEPTION WHEN OTHERS THEN
                        v_skip := NULL;
                    END;
                    IF v_skip = 'on' THEN RETURN NEW; END IF;
                    IF OLD.stock_quantity IS NOT DISTINCT FROM NEW.stock_quantity THEN RETURN NEW; END IF;

                    SELECT p.project_id INTO v_project_id
                      FROM products p
                      JOIN product_configurations_l1 l1 ON l1.product_id = p.id
                     WHERE l1.id = NEW.variation_id;
                    IF v_project_id IS NULL THEN RETURN NEW; END IF;

                    INSERT INTO product_stock_log
                        (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)
                    VALUES
                        (v_project_id, NEW.id, NULL,
                         NEW.stock_quantity - OLD.stock_quantity,
                         'manual_sql', NULL, NULL,
                         'External SQL change detected by trigger');
                    RETURN NEW;
                END;
                $$;


--
-- Name: touch_cart_items_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."touch_cart_items_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
                BEGIN
                    NEW.updated_at := NOW();
                    -- Clear the abandoned flag on the parent cart so the user can re-trigger after fresh activity.
                    UPDATE carts SET abandoned_email_sent_at = NULL WHERE id = NEW.cart_id;
                    RETURN NEW;
                END;
                $$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: api_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."api_settings" (
    "id" integer NOT NULL,
    "crm_user_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "field_key" character varying(100) NOT NULL,
    "field_value" "text",
    "field_type" character varying(20) DEFAULT 'string'::character varying NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "api_settings_field_type_check" CHECK ((("field_type")::"text" = ANY (ARRAY[('string'::character varying)::"text", ('number'::character varying)::"text", ('boolean'::character varying)::"text", ('json'::character varying)::"text"])))
);


--
-- Name: api_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."api_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."api_settings_id_seq" OWNED BY "public"."api_settings"."id";


--
-- Name: booking_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."booking_hours" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "staff_id" integer,
    "day_of_week" smallint NOT NULL,
    "open_time" time without time zone NOT NULL,
    "close_time" time without time zone NOT NULL
);


--
-- Name: booking_hours_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."booking_hours_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_hours_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."booking_hours_id_seq" OWNED BY "public"."booking_hours"."id";


--
-- Name: booking_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."booking_services" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "duration_minutes" integer DEFAULT 30 NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "image_url" character varying(1000),
    "is_active" boolean DEFAULT true NOT NULL,
    "requires_staff" boolean DEFAULT false NOT NULL,
    "capacity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "product_id" integer,
    "location_type" character varying(20) DEFAULT 'shop'::character varying NOT NULL,
    CONSTRAINT "booking_services_location_type_check" CHECK ((("location_type")::"text" = ANY (ARRAY[('shop'::character varying)::"text", ('customer'::character varying)::"text", ('either'::character varying)::"text"])))
);


--
-- Name: booking_services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."booking_services_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."booking_services_id_seq" OWNED BY "public"."booking_services"."id";


--
-- Name: booking_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."booking_settings" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "slot_interval_minutes" integer DEFAULT 15 NOT NULL,
    "min_advance_minutes" integer DEFAULT 60 NOT NULL,
    "max_advance_days" integer DEFAULT 60 NOT NULL,
    "cancellation_window_minutes" integer DEFAULT 1440 NOT NULL,
    "auto_confirm" boolean DEFAULT true NOT NULL,
    "default_status" character varying(20) DEFAULT 'confirmed'::character varying NOT NULL,
    "timezone" character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: booking_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."booking_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."booking_settings_id_seq" OWNED BY "public"."booking_settings"."id";


--
-- Name: booking_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."booking_staff" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(200) NOT NULL,
    "avatar_url" character varying(1000),
    "bio" "text" DEFAULT ''::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "commission_pct" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "booking_staff_commission_pct_check" CHECK ((("commission_pct" >= 0) AND ("commission_pct" <= 100)))
);


--
-- Name: booking_staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."booking_staff_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."booking_staff_id_seq" OWNED BY "public"."booking_staff"."id";


--
-- Name: booking_staff_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."booking_staff_services" (
    "staff_id" integer NOT NULL,
    "service_id" integer NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bookings" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "service_id" integer,
    "staff_id" integer,
    "user_id" integer,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "customer_name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "customer_phone" character varying(64) DEFAULT ''::character varying NOT NULL,
    "customer_email" character varying(200) DEFAULT ''::character varying NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "reminder_sent_at" timestamp with time zone,
    "customer_address" character varying(500) DEFAULT ''::character varying NOT NULL,
    "freeform_service_name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "freeform_duration_minutes" integer,
    "freeform_price" numeric(10,2)
);


--
-- Name: bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."bookings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bookings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."bookings_id_seq" OWNED BY "public"."bookings"."id";


--
-- Name: cart_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."cart_events" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "user_id" integer,
    "ip" character varying(64),
    "action" character varying(20) NOT NULL,
    "product_id" integer,
    "variation_id" integer,
    "configuration_id" integer,
    "quantity" integer,
    "promo_code" character varying(40),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cart_events_action_check" CHECK ((("action")::"text" = ANY (ARRAY[('add'::character varying)::"text", ('remove'::character varying)::"text", ('update_qty'::character varying)::"text", ('apply_promo'::character varying)::"text", ('remove_promo'::character varying)::"text"])))
);


--
-- Name: cart_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."cart_events_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cart_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."cart_events_id_seq" OWNED BY "public"."cart_events"."id";


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."cart_items" (
    "id" integer NOT NULL,
    "cart_id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "variation_id" integer NOT NULL,
    "configuration_id" integer NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "configuration_layer" smallint DEFAULT 2 NOT NULL,
    "selected_modifier_item_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "reserved_until" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: cart_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."cart_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cart_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."cart_items_id_seq" OWNED BY "public"."cart_items"."id";


--
-- Name: carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."carts" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "project_id" integer,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "abandoned_email_sent_at" timestamp with time zone
);


--
-- Name: carts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."carts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."carts_id_seq" OWNED BY "public"."carts"."id";


--
-- Name: checkout_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."checkout_events" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "user_id" integer,
    "ip" character varying(64),
    "step" character varying(30) NOT NULL,
    "fail_reason" character varying(200),
    "total_amount" numeric(12,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checkout_events_step_check" CHECK ((("step")::"text" = ANY (ARRAY[('started'::character varying)::"text", ('address_filled'::character varying)::"text", ('promo_tried'::character varying)::"text", ('submitted'::character varying)::"text", ('failed'::character varying)::"text"])))
);


--
-- Name: checkout_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."checkout_events_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checkout_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."checkout_events_id_seq" OWNED BY "public"."checkout_events"."id";


--
-- Name: crm_alert_fires; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_alert_fires" (
    "id" integer NOT NULL,
    "alert_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "message" "text" NOT NULL,
    "metric_val" numeric(14,2),
    "fired_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_alert_fires_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_alert_fires_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_alert_fires_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_alert_fires_id_seq" OWNED BY "public"."crm_alert_fires"."id";


--
-- Name: crm_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_alerts" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "type" character varying(40) NOT NULL,
    "threshold" numeric(12,2),
    "email" character varying(160) DEFAULT ''::character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_fired_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_alerts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_alerts_id_seq" OWNED BY "public"."crm_alerts"."id";


--
-- Name: crm_auth_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_auth_providers" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "provider" character varying(40) NOT NULL,
    "client_id" "text",
    "client_secret" "text",
    "is_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_auth_providers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_auth_providers_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_auth_providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_auth_providers_id_seq" OWNED BY "public"."crm_auth_providers"."id";


--
-- Name: crm_chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_chat_conversations" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "channel" character varying(32) NOT NULL,
    "external_chat_id" character varying(128) NOT NULL,
    "contact_uid" character varying(32) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "unread_count" integer DEFAULT 0 NOT NULL,
    "last_message_at" timestamp without time zone,
    "last_message_preview" "text" DEFAULT ''::"text",
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_chat_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_chat_conversations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_chat_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_chat_conversations_id_seq" OWNED BY "public"."crm_chat_conversations"."id";


--
-- Name: crm_chat_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_chat_integrations" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "channel" character varying(32) NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "bot_username" character varying(255) DEFAULT NULL::character varying,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_chat_integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_chat_integrations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_chat_integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_chat_integrations_id_seq" OWNED BY "public"."crm_chat_integrations"."id";


--
-- Name: crm_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_chat_messages" (
    "id" integer NOT NULL,
    "conversation_id" integer NOT NULL,
    "direction" character varying(8) NOT NULL,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "sender_user_id" integer,
    "external_msg_id" character varying(128) DEFAULT NULL::character varying,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "attachments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


--
-- Name: crm_chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_chat_messages_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_chat_messages_id_seq" OWNED BY "public"."crm_chat_messages"."id";


--
-- Name: crm_document_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_document_settings" (
    "project_id" integer NOT NULL,
    "style" character varying(20) DEFAULT 'modern'::character varying NOT NULL,
    "company_name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "logo_url" character varying(2000),
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "tax_id_label" character varying(40) DEFAULT 'Tax ID'::character varying NOT NULL,
    "tax_id" character varying(80) DEFAULT ''::character varying NOT NULL,
    "contact_email" character varying(200) DEFAULT ''::character varying NOT NULL,
    "contact_phone" character varying(40) DEFAULT ''::character varying NOT NULL,
    "footer_note" "text" DEFAULT ''::"text" NOT NULL,
    "accent_color" character varying(20) DEFAULT '#0071E3'::character varying NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_email_branding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_email_branding" (
    "project_id" integer NOT NULL,
    "logo_url" character varying(2000),
    "accent_color" character varying(20) DEFAULT '#0071E3'::character varying NOT NULL,
    "page_bg" character varying(20) DEFAULT '#f4f4f5'::character varying NOT NULL,
    "card_bg" character varying(20) DEFAULT '#ffffff'::character varying NOT NULL,
    "text_color" character varying(20) DEFAULT '#1d1d1f'::character varying NOT NULL,
    "font_family" character varying(120) DEFAULT 'Arial, Helvetica, sans-serif'::character varying NOT NULL,
    "header_text" character varying(200) DEFAULT ''::character varying NOT NULL,
    "footer_text" "text" DEFAULT ''::"text" NOT NULL,
    "social_links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_email_campaigns" (
    "id" bigint NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "subject" character varying(300) DEFAULT ''::character varying NOT NULL,
    "blocks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "schedule_type" character varying(20) DEFAULT 'now'::character varying NOT NULL,
    "scheduled_at" timestamp with time zone,
    "recur_dow" smallint,
    "recur_time" character varying(5),
    "exclude_guests" boolean DEFAULT true NOT NULL,
    "next_run_at" timestamp with time zone,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "total_count" integer DEFAULT 0 NOT NULL,
    "last_sent_at" timestamp with time zone,
    "last_error" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_email_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_email_campaigns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_email_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_email_campaigns_id_seq" OWNED BY "public"."crm_email_campaigns"."id";


--
-- Name: crm_email_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_email_domains" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "domain" character varying(255) NOT NULL,
    "from_name" character varying(100) DEFAULT 'Store'::character varying,
    "from_email" character varying(255) NOT NULL,
    "verify_token" character varying(64) DEFAULT ''::character varying NOT NULL,
    "is_verified" boolean DEFAULT false,
    "dkim_selector" character varying(50) DEFAULT 'torta'::character varying,
    "dkim_private" "text",
    "dkim_public" "text",
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "verified_at" timestamp without time zone,
    "sender_avatar" character varying(1000),
    "spf_ok" boolean DEFAULT false NOT NULL,
    "dmarc_ok" boolean DEFAULT false NOT NULL
);


--
-- Name: crm_email_domains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_email_domains_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_email_domains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_email_domains_id_seq" OWNED BY "public"."crm_email_domains"."id";


--
-- Name: crm_email_inbound; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_email_inbound" (
    "id" bigint NOT NULL,
    "project_id" integer NOT NULL,
    "message_id" "text" NOT NULL,
    "in_reply_to" "text",
    "references" "text",
    "from_email" "text" NOT NULL,
    "from_name" "text",
    "to_email" "text" NOT NULL,
    "subject" "text",
    "body_text" "text",
    "body_html" "text",
    "raw_size" integer DEFAULT 0 NOT NULL,
    "spf_pass" boolean,
    "dkim_pass" boolean,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conv_id" integer,
    "msg_id" integer
);


--
-- Name: crm_email_inbound_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_email_inbound_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_email_inbound_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_email_inbound_id_seq" OWNED BY "public"."crm_email_inbound"."id";


--
-- Name: crm_email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_email_templates" (
    "id" bigint NOT NULL,
    "project_id" integer,
    "type" character varying(40) NOT NULL,
    "subject" character varying(300) DEFAULT ''::character varying NOT NULL,
    "blocks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_email_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_email_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_email_templates_id_seq" OWNED BY "public"."crm_email_templates"."id";


--
-- Name: crm_goal_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_goal_events" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "goal_id" integer NOT NULL,
    "user_id" integer,
    "event_name" character varying(120),
    "value" numeric(14,2),
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_goal_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_goal_events_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_goal_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_goal_events_id_seq" OWNED BY "public"."crm_goal_events"."id";


--
-- Name: crm_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_goals" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(120) NOT NULL,
    "description" "text",
    "goal_type" character varying(40) NOT NULL,
    "target_value" numeric(14,2) NOT NULL,
    "period" character varying(20) DEFAULT '1mo'::character varying NOT NULL,
    "custom_event_name" character varying(120),
    "is_active" boolean DEFAULT true NOT NULL,
    "last_achieved_at" timestamp with time zone,
    "last_period_start" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crm_goals_period_check" CHECK ((("period")::"text" = ANY (ARRAY[('1d'::character varying)::"text", ('1w'::character varying)::"text", ('1mo'::character varying)::"text", ('season'::character varying)::"text", ('1y'::character varying)::"text", ('all_time'::character varying)::"text"]))),
    CONSTRAINT "crm_goals_type_check" CHECK ((("goal_type")::"text" = ANY (ARRAY[('revenue'::character varying)::"text", ('orders_count'::character varying)::"text", ('new_customers'::character varying)::"text", ('signups'::character varying)::"text", ('avg_order_value'::character varying)::"text", ('conversion_rate'::character varying)::"text", ('return_rate_max'::character varying)::"text", ('bookings_count'::character varying)::"text", ('avg_rating'::character varying)::"text", ('repeat_purchase_rate'::character varying)::"text", ('custom_event_count'::character varying)::"text"])))
);


--
-- Name: crm_goals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_goals_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_goals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_goals_id_seq" OWNED BY "public"."crm_goals"."id";


--
-- Name: crm_integration_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_integration_requests" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "crm_user_id" integer NOT NULL,
    "connector" character varying(60) NOT NULL,
    "notify_email" character varying(200) DEFAULT ''::character varying NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_integration_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_integration_requests_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_integration_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_integration_requests_id_seq" OWNED BY "public"."crm_integration_requests"."id";


--
-- Name: crm_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_invites" (
    "id" bigint NOT NULL,
    "org_id" integer NOT NULL,
    "email" character varying(255) NOT NULL,
    "token" character varying(64) NOT NULL,
    "crm_role_id" bigint,
    "project_id" integer,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "invited_by" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone
);


--
-- Name: crm_invites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_invites_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_invites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_invites_id_seq" OWNED BY "public"."crm_invites"."id";


--
-- Name: crm_kv_store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_kv_store" (
    "key" character varying(255) NOT NULL,
    "value" "jsonb" NOT NULL,
    "expires_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_low_stock_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_low_stock_alerts" (
    "id" bigint NOT NULL,
    "project_id" integer NOT NULL,
    "sku_id" integer NOT NULL,
    "alerted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stock_at_alert" integer NOT NULL,
    "threshold" integer NOT NULL
);


--
-- Name: crm_low_stock_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_low_stock_alerts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_low_stock_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_low_stock_alerts_id_seq" OWNED BY "public"."crm_low_stock_alerts"."id";


--
-- Name: crm_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_notifications" (
    "id" bigint NOT NULL,
    "user_id" integer NOT NULL,
    "project_id" integer,
    "type" character varying(40) NOT NULL,
    "title" character varying(200) NOT NULL,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "link" character varying(500),
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_notifications_id_seq" OWNED BY "public"."crm_notifications"."id";


--
-- Name: crm_oauth_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_oauth_settings" (
    "id" integer NOT NULL,
    "project_id" integer,
    "google_client_id" character varying(500),
    "google_client_secret" character varying(500),
    "google_enabled" boolean DEFAULT false
);


--
-- Name: crm_oauth_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_oauth_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_oauth_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_oauth_settings_id_seq" OWNED BY "public"."crm_oauth_settings"."id";


--
-- Name: crm_org_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_org_members" (
    "id" bigint NOT NULL,
    "org_id" integer NOT NULL,
    "crm_user_id" integer NOT NULL,
    "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_org_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_org_members_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_org_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_org_members_id_seq" OWNED BY "public"."crm_org_members"."id";


--
-- Name: crm_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_organizations" (
    "id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "owner_id" integer NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "sku_mode" character varying(20) DEFAULT 'numeric'::character varying NOT NULL,
    "sku_length" integer DEFAULT 8 NOT NULL,
    "batch_naming_mode" character varying(10) DEFAULT 'auto'::character varying NOT NULL,
    "batch_naming_format" character varying(80) DEFAULT 'B-{YYYY}{MM}-{seq:03}'::character varying NOT NULL,
    "payment_provider" character varying(30) DEFAULT 'manual'::character varying NOT NULL,
    "payment_account_label" character varying(160) DEFAULT ''::character varying NOT NULL,
    "payment_dashboard_url" character varying(600) DEFAULT ''::character varying NOT NULL,
    "currency" character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    "invite_token" character varying(64),
    "customers_shared" boolean DEFAULT true NOT NULL,
    "plan_slug" character varying(32) DEFAULT 'free'::character varying NOT NULL,
    "storage_used_bytes" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "crm_organizations_payment_provider_check" CHECK ((("payment_provider")::"text" = ANY ((ARRAY['stripe'::character varying, 'tinkoff'::character varying, 'cloudpayments'::character varying, 'yookassa'::character varying, 'paypal'::character varying, 'adyen'::character varying, 'braintree'::character varying, 'square'::character varying, 'mollie'::character varying, 'razorpay'::character varying, 'paddle'::character varying, 'paybox'::character varying, 'manual'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "crm_organizations_sku_mode_check" CHECK ((("sku_mode")::"text" = ANY (ARRAY[('numeric'::character varying)::"text", ('letters'::character varying)::"text", ('alphanumeric'::character varying)::"text", ('manual'::character varying)::"text"])))
);


--
-- Name: crm_organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_organizations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_organizations_id_seq" OWNED BY "public"."crm_organizations"."id";


--
-- Name: crm_payment_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_payment_credentials" (
    "id" bigint NOT NULL,
    "org_id" integer NOT NULL,
    "provider" character varying(30) NOT NULL,
    "credentials_encrypted" "text" DEFAULT ''::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT true NOT NULL,
    "is_connected" boolean DEFAULT false NOT NULL,
    "connected_at" timestamp with time zone,
    "last_verified_at" timestamp with time zone,
    "last_error" "text" DEFAULT ''::"text" NOT NULL,
    "stripe_account_id" character varying(120) DEFAULT ''::character varying NOT NULL,
    "connect_method" character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crm_payment_credentials_method_check" CHECK ((("connect_method")::"text" = ANY (ARRAY[('manual'::character varying)::"text", ('oauth'::character varying)::"text"]))),
    CONSTRAINT "crm_payment_credentials_provider_check" CHECK ((("provider")::"text" = ANY ((ARRAY['stripe'::character varying, 'tinkoff'::character varying, 'cloudpayments'::character varying, 'yookassa'::character varying, 'paypal'::character varying, 'adyen'::character varying, 'braintree'::character varying, 'square'::character varying, 'mollie'::character varying, 'razorpay'::character varying, 'paddle'::character varying, 'paybox'::character varying, 'manual'::character varying, 'other'::character varying])::"text"[])))
);


--
-- Name: crm_payment_credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_payment_credentials_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_payment_credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_payment_credentials_id_seq" OWNED BY "public"."crm_payment_credentials"."id";


--
-- Name: crm_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_projects" (
    "id" integer NOT NULL,
    "crm_user_id" integer NOT NULL,
    "org_id" integer,
    "name" character varying(100) NOT NULL,
    "api_key" character varying(128) NOT NULL,
    "publishable_key" character varying(60),
    "last_used_ip" character varying(45),
    "last_used_at" timestamp without time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "frontend_url" character varying(500),
    "batch_consumption_mode" character varying(10) DEFAULT 'fifo'::character varying NOT NULL,
    "barcode_include_date" boolean DEFAULT false NOT NULL,
    "barcode_include_batch" boolean DEFAULT false NOT NULL,
    "barcode_include_qty" boolean DEFAULT false NOT NULL,
    "barcode_include_serial" boolean DEFAULT false NOT NULL,
    "hide_price_in_overview" boolean DEFAULT false NOT NULL,
    "default_margin_percent" numeric(6,2) DEFAULT 50.00 NOT NULL,
    "batch_naming_mode" character varying(10) DEFAULT 'auto'::character varying NOT NULL,
    "batch_naming_format" character varying(80) DEFAULT 'B-{YYYY}{MM}-{seq:03}'::character varying NOT NULL,
    "batch_grouping_mode" character varying(10) DEFAULT 'config'::character varying NOT NULL,
    "barcode_binding" character varying(10) DEFAULT 'batch'::character varying NOT NULL,
    "timezone" character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    "currency" character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    "tz_auto" boolean DEFAULT true NOT NULL,
    "secret_key" character varying(60)
);


--
-- Name: crm_projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_projects_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_projects_id_seq" OWNED BY "public"."crm_projects"."id";


--
-- Name: crm_redirect_urls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_redirect_urls" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "url" character varying(500) NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: crm_redirect_urls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_redirect_urls_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_redirect_urls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_redirect_urls_id_seq" OWNED BY "public"."crm_redirect_urls"."id";


--
-- Name: crm_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_refresh_tokens" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "token_hash" character varying(64) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "revoke_reason" character varying(40),
    "rotated_to_id" integer,
    "parent_id" integer,
    "user_agent" "text",
    "ip" character varying(64),
    "label" character varying(100)
);


--
-- Name: crm_refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_refresh_tokens_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_refresh_tokens_id_seq" OWNED BY "public"."crm_refresh_tokens"."id";


--
-- Name: crm_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_role_permissions" (
    "id" integer NOT NULL,
    "role_id" integer NOT NULL,
    "permission" character varying(100) NOT NULL
);


--
-- Name: crm_role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_role_permissions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_role_permissions_id_seq" OWNED BY "public"."crm_role_permissions"."id";


--
-- Name: crm_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_roles" (
    "id" integer NOT NULL,
    "project_id" integer,
    "name" character varying(50) NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "org_id" integer,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_preset" boolean DEFAULT false NOT NULL
);


--
-- Name: crm_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_roles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_roles_id_seq" OWNED BY "public"."crm_roles"."id";


--
-- Name: crm_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_settings" (
    "id" integer NOT NULL,
    "crm_user_id" integer NOT NULL,
    "language" character varying(10) DEFAULT 'en'::character varying NOT NULL,
    "currency" character varying(10) DEFAULT 'USD'::character varying NOT NULL,
    "theme" character varying(10) DEFAULT 'system'::character varying NOT NULL,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "org_view" character varying(4) DEFAULT 'grid'::character varying NOT NULL,
    "org_sort" character varying(12) DEFAULT 'date_desc'::character varying NOT NULL,
    CONSTRAINT "crm_settings_theme_check" CHECK ((("theme")::"text" = ANY ((ARRAY['light'::character varying, 'dark'::character varying, 'system'::character varying])::"text"[])))
);


--
-- Name: crm_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_settings_id_seq" OWNED BY "public"."crm_settings"."id";


--
-- Name: crm_sms_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_sms_settings" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "provider" character varying(40) DEFAULT 'twilio'::character varying NOT NULL,
    "twilio_account_sid" "text",
    "twilio_auth_token" "text",
    "twilio_message_service_sid" "text",
    "twilio_content_sid" "text",
    "twilio_verify_service_sid" "text",
    "messagebird_access_key" "text",
    "messagebird_originator" "text",
    "textlocal_api_key" "text",
    "textlocal_sender" "text",
    "vonage_api_key" "text",
    "vonage_api_secret" "text",
    "vonage_from_number" "text",
    "enable_phone_confirmations" boolean DEFAULT true NOT NULL,
    "otp_expiry_seconds" integer DEFAULT 60 NOT NULL,
    "otp_length" integer DEFAULT 6 NOT NULL,
    "message_template" "text" DEFAULT 'Your code is {{ .Code }}'::"text" NOT NULL,
    "test_phone_numbers" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "aws_access_key_id" "text",
    "aws_secret_access_key" "text",
    "aws_region" "text",
    "plivo_auth_id" "text",
    "plivo_auth_token" "text",
    "plivo_from_number" "text",
    "smsc_login" "text",
    "smsc_password" "text",
    "smsc_sender" "text",
    "smsru_api_id" "text",
    "smsru_from" "text",
    "mobizon_api_key" "text",
    "mobizon_alpha" "text",
    "telegram_gateway_token" "text",
    "alicloud_access_key_id" "text",
    "alicloud_access_key_secret" "text",
    "alicloud_sign_name" "text",
    "alicloud_template_code" "text",
    "msg91_auth_key" "text",
    "msg91_template_id" "text",
    "msg91_sender_id" "text",
    "zenvia_api_token" "text",
    "zenvia_from" "text",
    "eskiz_email" "text",
    "eskiz_password" "text",
    "eskiz_from" "text",
    "whatsapp_phone_number_id" "text",
    "whatsapp_access_token" "text",
    "whatsapp_template_name" "text"
);


--
-- Name: crm_sms_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_sms_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_sms_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_sms_settings_id_seq" OWNED BY "public"."crm_sms_settings"."id";


--
-- Name: crm_subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_subscription_plans" (
    "slug" character varying(32) NOT NULL,
    "name" character varying(64) NOT NULL,
    "price_usd" numeric(10,2) NOT NULL,
    "limits" "jsonb" NOT NULL,
    "paddle_product_id" character varying(64),
    "paddle_price_id" character varying(64),
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_subscriptions" (
    "id" bigint NOT NULL,
    "org_id" bigint NOT NULL,
    "plan_slug" character varying(32) NOT NULL,
    "status" character varying(32) DEFAULT 'active'::character varying NOT NULL,
    "current_period_start" timestamp without time zone,
    "current_period_end" timestamp without time zone,
    "cancelled_at" timestamp without time zone,
    "trial_ends_at" timestamp without time zone,
    "paddle_customer_id" character varying(64),
    "paddle_subscription_id" character varying(64),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_subscriptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_subscriptions_id_seq" OWNED BY "public"."crm_subscriptions"."id";


--
-- Name: crm_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_team_members" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "crm_user_id" integer NOT NULL,
    "crm_role_id" integer NOT NULL,
    "invited_by" integer,
    "joined_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "org_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: crm_team_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_team_members_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_team_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_team_members_id_seq" OWNED BY "public"."crm_team_members"."id";


--
-- Name: crm_url_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_url_config" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "frontend_url" character varying(500)
);


--
-- Name: crm_url_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_url_config_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_url_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_url_config_id_seq" OWNED BY "public"."crm_url_config"."id";


--
-- Name: crm_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_users" (
    "id" integer NOT NULL,
    "name" character varying(80) NOT NULL,
    "email" character varying(120) NOT NULL,
    "password" character varying(128) DEFAULT ''::character varying NOT NULL,
    "role" character varying(20) DEFAULT 'manager'::character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_login_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "avatar_url" character varying(500),
    "google_id" character varying(255),
    "apple_id" character varying(255),
    "terms_accepted_at" timestamp with time zone,
    "terms_version" character varying(20) DEFAULT NULL::character varying,
    "terms_ip" character varying(45) DEFAULT NULL::character varying,
    CONSTRAINT "crm_users_role_check" CHECK ((("role")::"text" = ANY (ARRAY[('owner'::character varying)::"text", ('admin'::character varying)::"text", ('manager'::character varying)::"text"])))
);


--
-- Name: crm_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_users_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_users_id_seq" OWNED BY "public"."crm_users"."id";


--
-- Name: crm_webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_webhook_deliveries" (
    "id" integer NOT NULL,
    "subscription_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "event" character varying(64) NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "http_code" integer,
    "response_body" "text" DEFAULT ''::"text" NOT NULL,
    "duration_ms" integer,
    "attempt" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_webhook_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_webhook_deliveries_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_webhook_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_webhook_deliveries_id_seq" OWNED BY "public"."crm_webhook_deliveries"."id";


--
-- Name: crm_webhook_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_webhook_subscriptions" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "type" character varying(32) DEFAULT 'webhook'::character varying NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "url" character varying(2000) NOT NULL,
    "secret" character varying(120) DEFAULT ''::character varying NOT NULL,
    "events" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_status" character varying(20) DEFAULT 'unknown'::character varying NOT NULL,
    "last_error" "text" DEFAULT ''::"text" NOT NULL,
    "last_event_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: crm_webhook_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."crm_webhook_subscriptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_webhook_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."crm_webhook_subscriptions_id_seq" OWNED BY "public"."crm_webhook_subscriptions"."id";


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."favorites" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "project_id" integer
);


--
-- Name: favorites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."favorites_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: favorites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."favorites_id_seq" OWNED BY "public"."favorites"."id";


--
-- Name: inventory_batch_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inventory_batch_counters" (
    "project_id" integer NOT NULL,
    "period_key" character varying(20) NOT NULL,
    "counter" integer DEFAULT 0 NOT NULL
);


--
-- Name: inventory_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inventory_batches" (
    "id" bigint NOT NULL,
    "project_id" integer NOT NULL,
    "sku_id" integer NOT NULL,
    "warehouse_id" integer NOT NULL,
    "batch_name" character varying(80) NOT NULL,
    "production_date" "date",
    "expiry_date" "date",
    "quantity_received" integer NOT NULL,
    "quantity_remaining" integer NOT NULL,
    "cost_per_unit" numeric(12,2),
    "is_frozen" boolean DEFAULT false NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "received_by_user_id" integer,
    CONSTRAINT "inventory_batches_quantity_received_check" CHECK (("quantity_received" >= 0)),
    CONSTRAINT "inventory_batches_quantity_remaining_check" CHECK (("quantity_remaining" >= 0))
);


--
-- Name: inventory_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."inventory_batches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."inventory_batches_id_seq" OWNED BY "public"."inventory_batches"."id";


--
-- Name: order_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_history" (
    "id" integer NOT NULL,
    "project_id" integer,
    "user_id" integer,
    "total_amount" numeric(10,2) NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "delivered_at" timestamp without time zone,
    "address_id" integer,
    "payment_method_id" integer,
    "delivery_method" character varying(20) DEFAULT 'courier'::character varying,
    "recipient_name" character varying(255),
    "phone" character varying(50),
    "address" "text",
    "comment" "text",
    "payment_method" character varying(20) DEFAULT 'card'::character varying,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "payment_intent_id" character varying(160) DEFAULT ''::character varying NOT NULL,
    "payment_charge_id" character varying(160) DEFAULT ''::character varying NOT NULL,
    "payment_status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "payment_provider" character varying(30) DEFAULT 'manual'::character varying NOT NULL,
    "payment_currency" character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    "payment_amount_paid" numeric(10,2) DEFAULT 0 NOT NULL,
    "payment_amount_refunded" numeric(10,2) DEFAULT 0 NOT NULL,
    "payment_paid_at" timestamp with time zone,
    "fulfillment_type" character varying(20) DEFAULT 'courier'::character varying NOT NULL,
    "pickup_warehouse_id" integer,
    "stock_deducted" boolean DEFAULT false NOT NULL,
    "shipped_at" timestamp with time zone,
    "carrier_id" integer,
    "tracking_number" character varying(100) DEFAULT ''::character varying NOT NULL,
    "package_count" integer DEFAULT 1 NOT NULL,
    "ship_weight_grams" integer,
    "address_country" character varying(60),
    "address_city" character varying(120),
    "address_postal_code" character varying(20),
    "address_street" character varying(300),
    "address_apartment" character varying(120),
    "recipient_first_name" character varying(80),
    "recipient_last_name" character varying(80),
    "recipient_middle_name" character varying(80),
    "customer_email" character varying(255),
    "address_floor" character varying(20),
    "address_entrance" character varying(20),
    "address_intercom" character varying(40),
    CONSTRAINT "order_history_fulfillment_type_check" CHECK ((("fulfillment_type")::"text" = ANY (ARRAY[('courier'::character varying)::"text", ('pickup'::character varying)::"text"]))),
    CONSTRAINT "order_history_payment_status_check" CHECK ((("payment_status")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('paid'::character varying)::"text", ('failed'::character varying)::"text", ('refunded'::character varying)::"text", ('partial_refunded'::character varying)::"text", ('manual'::character varying)::"text"]))),
    CONSTRAINT "order_history_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('new'::character varying)::"text", ('confirmed'::character varying)::"text", ('shipped'::character varying)::"text", ('delivered'::character varying)::"text", ('cancelled'::character varying)::"text", ('refunded'::character varying)::"text"])))
);


--
-- Name: mv_cohort_retention; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW "public"."mv_cohort_retention" AS
 WITH "first_order" AS (
         SELECT "order_history"."project_id",
            "order_history"."user_id",
            "date_trunc"('month'::"text", "min"("order_history"."created_at")) AS "cohort_month"
           FROM "public"."order_history"
          WHERE (("order_history"."user_id" IS NOT NULL) AND (("order_history"."status")::"text" <> ALL (ARRAY[('cancelled'::character varying)::"text", ('refunded'::character varying)::"text"])))
          GROUP BY "order_history"."project_id", "order_history"."user_id"
        ), "activity" AS (
         SELECT "fo"."project_id",
            "fo"."cohort_month",
            "fo"."user_id",
            "date_trunc"('month'::"text", "oh"."created_at") AS "active_month"
           FROM ("public"."order_history" "oh"
             JOIN "first_order" "fo" ON ((("fo"."user_id" = "oh"."user_id") AND ("fo"."project_id" = "oh"."project_id"))))
          WHERE (("oh"."status")::"text" <> ALL (ARRAY[('cancelled'::character varying)::"text", ('refunded'::character varying)::"text"]))
        )
 SELECT "project_id",
    "cohort_month",
    ((EXTRACT(month FROM "age"("active_month", "cohort_month")))::integer + (12 * (EXTRACT(year FROM "age"("active_month", "cohort_month")))::integer)) AS "month_offset",
    ("count"(DISTINCT "user_id"))::integer AS "active_users"
   FROM "activity"
  GROUP BY "project_id", "cohort_month", ((EXTRACT(month FROM "age"("active_month", "cohort_month")))::integer + (12 * (EXTRACT(year FROM "age"("active_month", "cohort_month")))::integer))
  WITH NO DATA;


--
-- Name: order_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."order_history_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."order_history_id_seq" OWNED BY "public"."order_history"."id";


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_items" (
    "id" integer NOT NULL,
    "order_id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "variation_id" integer NOT NULL,
    "configuration_id" integer NOT NULL,
    "quantity" integer NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "configuration_layer" smallint DEFAULT 2 NOT NULL,
    "selected_modifier_item_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "cost_per_unit" numeric(10,2),
    "access_code" character varying(20)
);


--
-- Name: order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."order_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."order_items_id_seq" OWNED BY "public"."order_items"."id";


--
-- Name: order_return_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_return_items" (
    "id" bigint NOT NULL,
    "return_id" bigint NOT NULL,
    "order_item_id" integer NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "condition" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "restock_warehouse_id" integer,
    "restock_batch_id" bigint,
    "restocked_at" timestamp with time zone,
    "unit_refund_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "item_notes" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "order_return_items_condition_check" CHECK ((("condition")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('resellable'::character varying)::"text", ('damaged'::character varying)::"text", ('unrecoverable'::character varying)::"text"])))
);


--
-- Name: order_return_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."order_return_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_return_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."order_return_items_id_seq" OWNED BY "public"."order_return_items"."id";


--
-- Name: order_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_returns" (
    "id" bigint NOT NULL,
    "order_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "customer_user_id" integer,
    "status" character varying(20) DEFAULT 'requested'::character varying NOT NULL,
    "reason" character varying(40) DEFAULT 'other'::character varying NOT NULL,
    "customer_message" "text" DEFAULT ''::"text" NOT NULL,
    "customer_photos" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "approved_by" integer,
    "approved_at" timestamp with time zone,
    "rejected_reason" "text" DEFAULT ''::"text" NOT NULL,
    "received_by" integer,
    "received_at" timestamp with time zone,
    "inspected_by" integer,
    "inspected_at" timestamp with time zone,
    "refund_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "refund_method" character varying(40) DEFAULT ''::character varying NOT NULL,
    "refund_reference" character varying(120) DEFAULT ''::character varying NOT NULL,
    "refund_processed_by" integer,
    "refund_processed_at" timestamp with time zone,
    "restocking_fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "internal_notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_refund_id" character varying(160) DEFAULT ''::character varying NOT NULL,
    "provider_refund_status" character varying(30) DEFAULT ''::character varying NOT NULL,
    "provider_error" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "order_returns_reason_check" CHECK ((("reason")::"text" = ANY (ARRAY[('damaged'::character varying)::"text", ('wrong_item'::character varying)::"text", ('not_as_described'::character varying)::"text", ('changed_mind'::character varying)::"text", ('arrived_late'::character varying)::"text", ('quality_issue'::character varying)::"text", ('other'::character varying)::"text"]))),
    CONSTRAINT "order_returns_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('requested'::character varying)::"text", ('approved'::character varying)::"text", ('rejected'::character varying)::"text", ('received'::character varying)::"text", ('inspected'::character varying)::"text", ('refunded'::character varying)::"text", ('cancelled'::character varying)::"text"])))
);


--
-- Name: order_returns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."order_returns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."order_returns_id_seq" OWNED BY "public"."order_returns"."id";


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."payment_methods" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "provider" character varying(50) NOT NULL,
    "token" character varying(255) NOT NULL,
    "card_last4" character varying(4),
    "card_brand" character varying(20),
    "card_exp_month" smallint,
    "card_exp_year" smallint,
    "is_default" boolean DEFAULT false NOT NULL
);


--
-- Name: payment_methods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."payment_methods_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_methods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."payment_methods_id_seq" OWNED BY "public"."payment_methods"."id";


--
-- Name: payment_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."payment_webhook_events" (
    "id" bigint NOT NULL,
    "provider" character varying(30) NOT NULL,
    "event_id" character varying(160) NOT NULL,
    "project_id" integer,
    "order_id" integer,
    "payment_intent_id" character varying(160),
    "event_type" character varying(80) NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "signature_valid" boolean DEFAULT false NOT NULL,
    "processed_ok" boolean DEFAULT false NOT NULL,
    "processing_error" "text" DEFAULT ''::"text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: payment_webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."payment_webhook_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."payment_webhook_events_id_seq" OWNED BY "public"."payment_webhook_events"."id";


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_categories" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(120) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_categories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_categories_id_seq" OWNED BY "public"."product_categories"."id";


--
-- Name: product_configurations_l1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_configurations_l1" (
    "id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "variation_name" character varying(50) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "price" numeric(10,2),
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "sold_quantity" integer DEFAULT 0 NOT NULL,
    "images" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "media_alt" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "default_specs_seeded" boolean DEFAULT false NOT NULL,
    "sale_type" character varying(20),
    "sale_value" numeric(10,2),
    "sale_starts_at" timestamp with time zone,
    "sale_ends_at" timestamp with time zone,
    "weight_g" numeric(10,2),
    "cost_price" numeric(10,2),
    CONSTRAINT "product_configurations_l1_sale_type_check" CHECK ((("sale_type" IS NULL) OR (("sale_type")::"text" = ANY (ARRAY[('percent'::character varying)::"text", ('amount'::character varying)::"text", ('fixed'::character varying)::"text"]))))
);


--
-- Name: product_configurations_l2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_configurations_l2" (
    "id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "variation_id" integer NOT NULL,
    "configuration_name" character varying(20) NOT NULL,
    "price" numeric(10,2) DEFAULT 0.00,
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "sold_quantity" integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "sku_code" character varying(80) DEFAULT ''::character varying NOT NULL,
    "compare_at_price" numeric(10,2),
    "cost_price" numeric(10,2),
    "weight_g" numeric(10,2),
    "length_cm" numeric(10,2),
    "width_cm" numeric(10,2),
    "height_cm" numeric(10,2),
    "sale_price" numeric(10,2),
    "sale_starts_at" timestamp with time zone,
    "sale_ends_at" timestamp with time zone,
    "barcode" character varying(80) DEFAULT ''::character varying NOT NULL,
    "sale_type" character varying(20),
    "sale_value" numeric(10,2),
    "reserved_quantity" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "product_configurations_l2_sale_type_check" CHECK ((("sale_type" IS NULL) OR (("sale_type")::"text" = ANY (ARRAY[('percent'::character varying)::"text", ('amount'::character varying)::"text", ('fixed'::character varying)::"text"]))))
);


--
-- Name: product_configurations_l3; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_configurations_l3" (
    "id" integer NOT NULL,
    "parent_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "price" numeric(10,2),
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "sold_quantity" integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "weight_g" numeric(10,2),
    "cost_price" numeric(10,2)
);


--
-- Name: product_configurations_l3_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_configurations_l3_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_configurations_l3_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_configurations_l3_id_seq" OWNED BY "public"."product_configurations_l3"."id";


--
-- Name: product_configurations_l4; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_configurations_l4" (
    "id" integer NOT NULL,
    "parent_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "price" numeric(10,2),
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "sold_quantity" integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "weight_g" numeric(10,2),
    "cost_price" numeric(10,2)
);


--
-- Name: product_configurations_l4_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_configurations_l4_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_configurations_l4_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_configurations_l4_id_seq" OWNED BY "public"."product_configurations_l4"."id";


--
-- Name: product_configurations_l5; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_configurations_l5" (
    "id" integer NOT NULL,
    "parent_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "price" numeric(10,2),
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "sold_quantity" integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "weight_g" numeric(10,2),
    "cost_price" numeric(10,2)
);


--
-- Name: product_configurations_l5_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_configurations_l5_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_configurations_l5_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_configurations_l5_id_seq" OWNED BY "public"."product_configurations_l5"."id";


--
-- Name: product_custom_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_custom_fields" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "field_key" character varying(100) NOT NULL,
    "field_value" "text",
    "field_type" character varying(20) DEFAULT 'string'::character varying NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "is_global" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "product_custom_fields_field_type_check" CHECK ((("field_type")::"text" = ANY (ARRAY[('string'::character varying)::"text", ('number'::character varying)::"text", ('boolean'::character varying)::"text", ('json'::character varying)::"text"])))
);


--
-- Name: product_custom_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_custom_fields_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_custom_fields_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_custom_fields_id_seq" OWNED BY "public"."product_custom_fields"."id";


--
-- Name: product_modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_modifier_groups" (
    "id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "control_type" character varying(16) DEFAULT 'checkbox'::character varying NOT NULL,
    "min_select" integer DEFAULT 0 NOT NULL,
    "max_select" integer,
    "is_required" boolean DEFAULT false NOT NULL,
    "default_item_id" integer,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_modifier_control" CHECK ((("control_type")::"text" = ANY (ARRAY[('checkbox'::character varying)::"text", ('radio'::character varying)::"text"])))
);


--
-- Name: product_modifier_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_modifier_groups_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_modifier_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_modifier_groups_id_seq" OWNED BY "public"."product_modifier_groups"."id";


--
-- Name: product_modifier_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_modifier_items" (
    "id" integer NOT NULL,
    "group_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "price_delta" numeric(10,2) DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_modifier_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_modifier_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_modifier_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_modifier_items_id_seq" OWNED BY "public"."product_modifier_items"."id";


--
-- Name: product_modifier_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_modifier_options" (
    "id" integer NOT NULL,
    "group_id" integer NOT NULL,
    "name" character varying(160) DEFAULT ''::character varying NOT NULL,
    "price_delta" numeric(10,2) DEFAULT 0 NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_modifier_options_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_modifier_options_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_modifier_options_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_modifier_options_id_seq" OWNED BY "public"."product_modifier_options"."id";


--
-- Name: product_page_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_page_views" (
    "id" integer NOT NULL,
    "project_id" integer,
    "product_id" integer NOT NULL,
    "user_id" integer,
    "ip" character varying(45) NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "country_code" character(2),
    "country_name" character varying(80),
    "city" character varying(120),
    "user_agent" "text",
    "device_type" character varying(20),
    "browser" character varying(40),
    "os" character varying(40),
    "referrer" character varying(500),
    "referrer_host" character varying(200),
    "traffic_source" character varying(20),
    "utm_source" character varying(100),
    "utm_medium" character varying(100),
    "utm_campaign" character varying(100),
    "language" character varying(20),
    "screen_width" integer
);


--
-- Name: product_page_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_page_views_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_page_views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_page_views_id_seq" OWNED BY "public"."product_page_views"."id";


--
-- Name: product_restock_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_restock_subscriptions" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "sku_id" integer,
    "email" character varying(200) NOT NULL,
    "user_id" integer,
    "notified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_restock_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_restock_subscriptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_restock_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_restock_subscriptions_id_seq" OWNED BY "public"."product_restock_subscriptions"."id";


--
-- Name: product_review_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_review_photos" (
    "id" integer NOT NULL,
    "review_id" integer NOT NULL,
    "url" character varying(1000) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_review_photos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_review_photos_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_review_photos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_review_photos_id_seq" OWNED BY "public"."product_review_photos"."id";


--
-- Name: product_review_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_review_votes" (
    "id" integer NOT NULL,
    "review_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "is_helpful" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_review_votes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_review_votes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_review_votes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_review_votes_id_seq" OWNED BY "public"."product_review_votes"."id";


--
-- Name: product_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_reviews" (
    "id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "rating" smallint NOT NULL,
    "comment" "text",
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "project_id" integer,
    "merchant_reply" "text",
    "merchant_reply_at" timestamp with time zone
);


--
-- Name: product_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_reviews_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_reviews_id_seq" OWNED BY "public"."product_reviews"."id";


--
-- Name: product_sizes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_sizes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_sizes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_sizes_id_seq" OWNED BY "public"."product_configurations_l2"."id";


--
-- Name: product_spec_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_spec_groups" (
    "id" integer NOT NULL,
    "product_id" integer NOT NULL,
    "layer" smallint DEFAULT 1 NOT NULL,
    "parent_id" integer NOT NULL,
    "name" character varying(200) DEFAULT ''::character varying NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_spec_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_spec_groups_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_spec_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_spec_groups_id_seq" OWNED BY "public"."product_spec_groups"."id";


--
-- Name: product_specifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_specifications" (
    "id" integer NOT NULL,
    "variation_id" integer,
    "spec_key" character varying(200) DEFAULT ''::character varying NOT NULL,
    "spec_value" character varying(1000) DEFAULT ''::character varying NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "layer" smallint DEFAULT 1 NOT NULL,
    "parent_id" integer,
    "group_id" integer
);


--
-- Name: product_specifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_specifications_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_specifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_specifications_id_seq" OWNED BY "public"."product_specifications"."id";


--
-- Name: product_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_stock" (
    "id" integer NOT NULL,
    "sku_id" integer NOT NULL,
    "warehouse_id" integer NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "sold_quantity" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reserved_quantity" integer DEFAULT 0 NOT NULL
);


--
-- Name: product_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_stock_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_stock_id_seq" OWNED BY "public"."product_stock"."id";


--
-- Name: product_stock_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_stock_log" (
    "id" bigint NOT NULL,
    "project_id" integer NOT NULL,
    "sku_id" integer NOT NULL,
    "warehouse_id" integer,
    "delta" integer NOT NULL,
    "reason" character varying(40) NOT NULL,
    "reference_id" integer,
    "user_id" integer,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_stock_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_stock_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_stock_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_stock_log_id_seq" OWNED BY "public"."product_stock_log"."id";


--
-- Name: product_tax_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_tax_categories" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(120) NOT NULL,
    "rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_tax_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_tax_categories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_tax_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_tax_categories_id_seq" OWNED BY "public"."product_tax_categories"."id";


--
-- Name: product_tier_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_tier_pricing" (
    "id" integer NOT NULL,
    "sku_id" integer NOT NULL,
    "min_qty" integer NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_tier_pricing_min_qty_check" CHECK (("min_qty" >= 1)),
    CONSTRAINT "product_tier_pricing_price_check" CHECK (("price" >= (0)::numeric))
);


--
-- Name: product_tier_pricing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_tier_pricing_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_tier_pricing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_tier_pricing_id_seq" OWNED BY "public"."product_tier_pricing"."id";


--
-- Name: product_variations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."product_variations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_variations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."product_variations_id_seq" OWNED BY "public"."product_configurations_l1"."id";


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."products" (
    "id" integer NOT NULL,
    "project_id" integer,
    "title" character varying(255) NOT NULL,
    "subtitle" "text",
    "description" "text",
    "seo_title" character varying(70),
    "seo_description" character varying(160),
    "seo_keywords" character varying(255),
    "category_id" integer,
    "product_type" character varying(16) DEFAULT 'physical'::character varying NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "is_paused" boolean DEFAULT false NOT NULL,
    "sku" character varying(80) DEFAULT ''::character varying NOT NULL,
    "barcode" character varying(80) DEFAULT ''::character varying NOT NULL,
    "brand" character varying(120) DEFAULT ''::character varying NOT NULL,
    "manufacturer" character varying(120) DEFAULT ''::character varying NOT NULL,
    "vendor" character varying(120) DEFAULT ''::character varying NOT NULL,
    "country_of_origin" character varying(80) DEFAULT ''::character varying NOT NULL,
    "hs_code" character varying(20) DEFAULT ''::character varying NOT NULL,
    "og_image_url" character varying(1000),
    "requires_shipping" boolean DEFAULT true NOT NULL,
    "ships_internationally" boolean DEFAULT false NOT NULL,
    "shipping_class" character varying(40) DEFAULT 'standard'::character varying NOT NULL,
    "lead_time_days" integer DEFAULT 0 NOT NULL,
    "continue_selling_oos" boolean DEFAULT false NOT NULL,
    "moq" integer DEFAULT 1 NOT NULL,
    "order_increment" integer DEFAULT 1 NOT NULL,
    "low_stock_threshold" integer DEFAULT 0 NOT NULL,
    "is_pre_order" boolean DEFAULT false NOT NULL,
    "pre_order_release_at" timestamp with time zone,
    "net_terms_days" integer DEFAULT 0 NOT NULL,
    "allow_po" boolean DEFAULT false NOT NULL,
    "tax_category_id" integer,
    "sale_type" character varying(20),
    "sale_value" numeric(10,2),
    "sale_starts_at" timestamp with time zone,
    "sale_ends_at" timestamp with time zone,
    "weight_grams" integer,
    CONSTRAINT "products_product_type_check" CHECK ((("product_type")::"text" = ANY (ARRAY[('physical'::character varying)::"text", ('digital'::character varying)::"text", ('service'::character varying)::"text"]))),
    CONSTRAINT "products_sale_type_check" CHECK ((("sale_type" IS NULL) OR (("sale_type")::"text" = ANY (ARRAY[('percent'::character varying)::"text", ('amount'::character varying)::"text", ('fixed'::character varying)::"text"])))),
    CONSTRAINT "products_shipping_class_check" CHECK ((("shipping_class")::"text" = ANY (ARRAY[('standard'::character varying)::"text", ('fragile'::character varying)::"text", ('oversized'::character varying)::"text", ('hazmat'::character varying)::"text", ('perishable'::character varying)::"text"])))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."products_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."products_id_seq" OWNED BY "public"."products"."id";


--
-- Name: promo_code_uses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."promo_code_uses" (
    "id" integer NOT NULL,
    "promo_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "order_id" integer,
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: promo_code_uses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."promo_code_uses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promo_code_uses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."promo_code_uses_id_seq" OWNED BY "public"."promo_code_uses"."id";


--
-- Name: promo_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."promo_codes" (
    "id" integer NOT NULL,
    "project_id" integer,
    "code" character varying(50) NOT NULL,
    "discount_type" character varying(20) DEFAULT 'percentage'::character varying,
    "discount_value" numeric(10,2) NOT NULL,
    "min_order_amount" numeric(10,2) DEFAULT 0.00,
    "max_discount" numeric(10,2),
    "valid_from" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "valid_until" timestamp without time zone,
    "usage_limit" integer,
    "times_used" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "per_user_limit" integer,
    "category_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
    CONSTRAINT "promo_codes_discount_type_check" CHECK ((("discount_type")::"text" = ANY (ARRAY[('percentage'::character varying)::"text", ('fixed'::character varying)::"text"])))
);


--
-- Name: promo_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."promo_codes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promo_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."promo_codes_id_seq" OWNED BY "public"."promo_codes"."id";


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."refresh_tokens" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "token_hash" character varying(64) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "revoke_reason" character varying(40),
    "rotated_to_id" integer,
    "parent_id" integer,
    "user_agent" "text",
    "ip" character varying(64),
    "label" character varying(100)
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."refresh_tokens_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."refresh_tokens_id_seq" OWNED BY "public"."refresh_tokens"."id";


--
-- Name: search_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."search_queries" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "user_id" integer,
    "ip" character varying(64),
    "query" character varying(200) NOT NULL,
    "results_count" integer DEFAULT 0 NOT NULL,
    "country_code" character(2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: search_queries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."search_queries_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: search_queries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."search_queries_id_seq" OWNED BY "public"."search_queries"."id";


--
-- Name: shipping_carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shipping_carriers" (
    "id" integer NOT NULL,
    "code" character varying(40) NOT NULL,
    "name" character varying(120) NOT NULL,
    "country_code" character(2),
    "tracking_url_template" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: shipping_carriers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."shipping_carriers_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_carriers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."shipping_carriers_id_seq" OWNED BY "public"."shipping_carriers"."id";


--
-- Name: shipping_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shipping_settings" (
    "id" integer NOT NULL,
    "project_id" integer,
    "shipping_cost" numeric(10,2) DEFAULT 10.00,
    "free_shipping_threshold" numeric(10,2) DEFAULT 2000.00,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipping_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."shipping_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."shipping_settings_id_seq" OWNED BY "public"."shipping_settings"."id";


--
-- Name: site_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."site_visits" (
    "id" integer NOT NULL,
    "project_id" integer,
    "user_id" integer,
    "ip" character varying(45) NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "country_code" character(2),
    "country_name" character varying(80),
    "city" character varying(120),
    "user_agent" "text",
    "device_type" character varying(20),
    "browser" character varying(40),
    "os" character varying(40),
    "referrer" character varying(500),
    "referrer_host" character varying(200),
    "traffic_source" character varying(20),
    "utm_source" character varying(100),
    "utm_medium" character varying(100),
    "utm_campaign" character varying(100),
    "language" character varying(20),
    "screen_width" integer
);


--
-- Name: site_visits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."site_visits_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_visits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."site_visits_id_seq" OWNED BY "public"."site_visits"."id";


--
-- Name: user_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."user_addresses" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "country" character varying(80) DEFAULT ''::character varying NOT NULL,
    "region" character varying(80) DEFAULT ''::character varying NOT NULL,
    "city" character varying(80) DEFAULT ''::character varying NOT NULL,
    "street" character varying(120) DEFAULT ''::character varying NOT NULL,
    "postal_code" character varying(20) DEFAULT ''::character varying NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "project_id" integer,
    "label" character varying(60) DEFAULT ''::character varying NOT NULL,
    "apartment" character varying(120) DEFAULT ''::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "floor" character varying(20) DEFAULT ''::character varying NOT NULL,
    "entrance" character varying(20) DEFAULT ''::character varying NOT NULL,
    "intercom" character varying(40) DEFAULT ''::character varying NOT NULL
);


--
-- Name: user_addresses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."user_addresses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_addresses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."user_addresses_id_seq" OWNED BY "public"."user_addresses"."id";


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."users" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "email" character varying(120),
    "password_hash" character varying(128) DEFAULT ''::character varying NOT NULL,
    "name" character varying(80),
    "phone" character varying(30),
    "is_active" boolean DEFAULT true NOT NULL,
    "last_login_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "avatar_url" character varying(500),
    "google_id" character varying(255),
    "reset_token" character varying(64),
    "reset_expires" timestamp without time zone,
    "oauth_provider" character varying(40) DEFAULT NULL::character varying,
    "oauth_provider_id" character varying(255) DEFAULT NULL::character varying,
    "phone_verified" boolean DEFAULT false,
    "is_guest" boolean DEFAULT false,
    "email_opt_out" boolean DEFAULT false NOT NULL,
    "unsubscribe_token" character varying(64),
    "org_id" integer,
    "last_name" character varying(200) DEFAULT NULL::character varying,
    "birthdate" "date",
    "address" character varying(500) DEFAULT NULL::character varying,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_external" boolean DEFAULT false
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."users_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."users_id_seq" OWNED BY "public"."users"."id";


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."warehouses" (
    "id" integer NOT NULL,
    "project_id" integer NOT NULL,
    "name" character varying(120) NOT NULL,
    "code" character varying(40) DEFAULT ''::character varying NOT NULL,
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "country" character varying(80) DEFAULT ''::character varying NOT NULL,
    "city" character varying(120) DEFAULT ''::character varying NOT NULL,
    "street" character varying(255) DEFAULT ''::character varying NOT NULL,
    "postal_code" character varying(40) DEFAULT ''::character varying NOT NULL,
    "region" character varying(120) DEFAULT ''::character varying NOT NULL,
    "contact_name" character varying(120) DEFAULT ''::character varying NOT NULL,
    "contact_phone" character varying(40) DEFAULT ''::character varying NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "is_pickup_enabled" boolean DEFAULT false NOT NULL,
    "pickup_hours" character varying(200) DEFAULT ''::character varying NOT NULL,
    "delivery_eta_min_days" integer,
    "delivery_eta_max_days" integer
);


--
-- Name: warehouses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."warehouses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."warehouses_id_seq" OWNED BY "public"."warehouses"."id";


--
-- Name: api_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."api_settings_id_seq"'::"regclass");


--
-- Name: booking_hours id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_hours" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_hours_id_seq"'::"regclass");


--
-- Name: booking_services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_services" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_services_id_seq"'::"regclass");


--
-- Name: booking_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_settings_id_seq"'::"regclass");


--
-- Name: booking_staff id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_staff" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_staff_id_seq"'::"regclass");


--
-- Name: bookings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bookings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bookings_id_seq"'::"regclass");


--
-- Name: cart_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cart_events_id_seq"'::"regclass");


--
-- Name: cart_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cart_items_id_seq"'::"regclass");


--
-- Name: carts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."carts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."carts_id_seq"'::"regclass");


--
-- Name: checkout_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkout_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."checkout_events_id_seq"'::"regclass");


--
-- Name: crm_alert_fires id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alert_fires" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_alert_fires_id_seq"'::"regclass");


--
-- Name: crm_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alerts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_alerts_id_seq"'::"regclass");


--
-- Name: crm_auth_providers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_auth_providers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_auth_providers_id_seq"'::"regclass");


--
-- Name: crm_chat_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_conversations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_chat_conversations_id_seq"'::"regclass");


--
-- Name: crm_chat_integrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_integrations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_chat_integrations_id_seq"'::"regclass");


--
-- Name: crm_chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_chat_messages_id_seq"'::"regclass");


--
-- Name: crm_email_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_campaigns" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_email_campaigns_id_seq"'::"regclass");


--
-- Name: crm_email_domains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_domains" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_email_domains_id_seq"'::"regclass");


--
-- Name: crm_email_inbound id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_inbound" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_email_inbound_id_seq"'::"regclass");


--
-- Name: crm_email_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_templates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_email_templates_id_seq"'::"regclass");


--
-- Name: crm_goal_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goal_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_goal_events_id_seq"'::"regclass");


--
-- Name: crm_goals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goals" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_goals_id_seq"'::"regclass");


--
-- Name: crm_integration_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_integration_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_integration_requests_id_seq"'::"regclass");


--
-- Name: crm_invites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_invites" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_invites_id_seq"'::"regclass");


--
-- Name: crm_low_stock_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_low_stock_alerts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_low_stock_alerts_id_seq"'::"regclass");


--
-- Name: crm_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_notifications_id_seq"'::"regclass");


--
-- Name: crm_oauth_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_oauth_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_oauth_settings_id_seq"'::"regclass");


--
-- Name: crm_org_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_org_members" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_org_members_id_seq"'::"regclass");


--
-- Name: crm_organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_organizations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_organizations_id_seq"'::"regclass");


--
-- Name: crm_payment_credentials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_payment_credentials" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_payment_credentials_id_seq"'::"regclass");


--
-- Name: crm_projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_projects" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_projects_id_seq"'::"regclass");


--
-- Name: crm_redirect_urls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_redirect_urls" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_redirect_urls_id_seq"'::"regclass");


--
-- Name: crm_refresh_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_refresh_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_refresh_tokens_id_seq"'::"regclass");


--
-- Name: crm_role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_role_permissions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_role_permissions_id_seq"'::"regclass");


--
-- Name: crm_roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_roles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_roles_id_seq"'::"regclass");


--
-- Name: crm_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_settings_id_seq"'::"regclass");


--
-- Name: crm_sms_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_sms_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_sms_settings_id_seq"'::"regclass");


--
-- Name: crm_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_subscriptions_id_seq"'::"regclass");


--
-- Name: crm_team_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_team_members_id_seq"'::"regclass");


--
-- Name: crm_url_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_url_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_url_config_id_seq"'::"regclass");


--
-- Name: crm_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_users" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_users_id_seq"'::"regclass");


--
-- Name: crm_webhook_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_deliveries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_webhook_deliveries_id_seq"'::"regclass");


--
-- Name: crm_webhook_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crm_webhook_subscriptions_id_seq"'::"regclass");


--
-- Name: favorites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."favorites" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."favorites_id_seq"'::"regclass");


--
-- Name: inventory_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inventory_batches_id_seq"'::"regclass");


--
-- Name: order_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_history_id_seq"'::"regclass");


--
-- Name: order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_items_id_seq"'::"regclass");


--
-- Name: order_return_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_return_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_return_items_id_seq"'::"regclass");


--
-- Name: order_returns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_returns" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_returns_id_seq"'::"regclass");


--
-- Name: payment_methods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payment_methods" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."payment_methods_id_seq"'::"regclass");


--
-- Name: payment_webhook_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payment_webhook_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."payment_webhook_events_id_seq"'::"regclass");


--
-- Name: product_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_categories_id_seq"'::"regclass");


--
-- Name: product_configurations_l1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l1" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_variations_id_seq"'::"regclass");


--
-- Name: product_configurations_l2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l2" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_sizes_id_seq"'::"regclass");


--
-- Name: product_configurations_l3 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l3" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_configurations_l3_id_seq"'::"regclass");


--
-- Name: product_configurations_l4 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l4" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_configurations_l4_id_seq"'::"regclass");


--
-- Name: product_configurations_l5 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l5" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_configurations_l5_id_seq"'::"regclass");


--
-- Name: product_custom_fields id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_custom_fields" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_custom_fields_id_seq"'::"regclass");


--
-- Name: product_modifier_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_groups" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_modifier_groups_id_seq"'::"regclass");


--
-- Name: product_modifier_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_modifier_items_id_seq"'::"regclass");


--
-- Name: product_modifier_options id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_options" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_modifier_options_id_seq"'::"regclass");


--
-- Name: product_page_views id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_page_views" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_page_views_id_seq"'::"regclass");


--
-- Name: product_restock_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_restock_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_restock_subscriptions_id_seq"'::"regclass");


--
-- Name: product_review_photos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_photos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_review_photos_id_seq"'::"regclass");


--
-- Name: product_review_votes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_votes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_review_votes_id_seq"'::"regclass");


--
-- Name: product_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_reviews" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_reviews_id_seq"'::"regclass");


--
-- Name: product_spec_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_spec_groups" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_spec_groups_id_seq"'::"regclass");


--
-- Name: product_specifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_specifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_specifications_id_seq"'::"regclass");


--
-- Name: product_stock id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_stock_id_seq"'::"regclass");


--
-- Name: product_stock_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_stock_log_id_seq"'::"regclass");


--
-- Name: product_tax_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tax_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_tax_categories_id_seq"'::"regclass");


--
-- Name: product_tier_pricing id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tier_pricing" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_tier_pricing_id_seq"'::"regclass");


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."products_id_seq"'::"regclass");


--
-- Name: promo_code_uses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_code_uses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."promo_code_uses_id_seq"'::"regclass");


--
-- Name: promo_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_codes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."promo_codes_id_seq"'::"regclass");


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."refresh_tokens_id_seq"'::"regclass");


--
-- Name: search_queries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."search_queries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."search_queries_id_seq"'::"regclass");


--
-- Name: shipping_carriers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shipping_carriers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."shipping_carriers_id_seq"'::"regclass");


--
-- Name: shipping_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shipping_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."shipping_settings_id_seq"'::"regclass");


--
-- Name: site_visits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."site_visits" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."site_visits_id_seq"'::"regclass");


--
-- Name: user_addresses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_addresses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_addresses_id_seq"'::"regclass");


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."users_id_seq"'::"regclass");


--
-- Name: warehouses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."warehouses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."warehouses_id_seq"'::"regclass");


--
-- Name: crm_oauth_settings api_key_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_oauth_settings"
    ADD CONSTRAINT "api_key_id" UNIQUE ("project_id");


--
-- Name: api_settings api_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_settings"
    ADD CONSTRAINT "api_settings_pkey" PRIMARY KEY ("id");


--
-- Name: booking_hours booking_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_hours"
    ADD CONSTRAINT "booking_hours_pkey" PRIMARY KEY ("id");


--
-- Name: booking_services booking_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_services"
    ADD CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id");


--
-- Name: booking_settings booking_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_settings"
    ADD CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("id");


--
-- Name: booking_settings booking_settings_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_settings"
    ADD CONSTRAINT "booking_settings_project_id_key" UNIQUE ("project_id");


--
-- Name: booking_staff booking_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_pkey" PRIMARY KEY ("id");


--
-- Name: booking_staff_services booking_staff_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_staff_services"
    ADD CONSTRAINT "booking_staff_services_pkey" PRIMARY KEY ("staff_id", "service_id");


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");


--
-- Name: cart_events cart_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_events"
    ADD CONSTRAINT "cart_events_pkey" PRIMARY KEY ("id");


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id");


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_pkey" PRIMARY KEY ("id");


--
-- Name: checkout_events checkout_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkout_events"
    ADD CONSTRAINT "checkout_events_pkey" PRIMARY KEY ("id");


--
-- Name: crm_alert_fires crm_alert_fires_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alert_fires"
    ADD CONSTRAINT "crm_alert_fires_pkey" PRIMARY KEY ("id");


--
-- Name: crm_alerts crm_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alerts"
    ADD CONSTRAINT "crm_alerts_pkey" PRIMARY KEY ("id");


--
-- Name: crm_auth_providers crm_auth_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_auth_providers"
    ADD CONSTRAINT "crm_auth_providers_pkey" PRIMARY KEY ("id");


--
-- Name: crm_auth_providers crm_auth_providers_project_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_auth_providers"
    ADD CONSTRAINT "crm_auth_providers_project_id_provider_key" UNIQUE ("project_id", "provider");


--
-- Name: crm_chat_conversations crm_chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_conversations"
    ADD CONSTRAINT "crm_chat_conversations_pkey" PRIMARY KEY ("id");


--
-- Name: crm_chat_conversations crm_chat_conversations_project_id_channel_external_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_conversations"
    ADD CONSTRAINT "crm_chat_conversations_project_id_channel_external_chat_id_key" UNIQUE ("project_id", "channel", "external_chat_id");


--
-- Name: crm_chat_integrations crm_chat_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_integrations"
    ADD CONSTRAINT "crm_chat_integrations_pkey" PRIMARY KEY ("id");


--
-- Name: crm_chat_integrations crm_chat_integrations_project_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_integrations"
    ADD CONSTRAINT "crm_chat_integrations_project_id_channel_key" UNIQUE ("project_id", "channel");


--
-- Name: crm_chat_messages crm_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_messages"
    ADD CONSTRAINT "crm_chat_messages_pkey" PRIMARY KEY ("id");


--
-- Name: crm_document_settings crm_document_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_document_settings"
    ADD CONSTRAINT "crm_document_settings_pkey" PRIMARY KEY ("project_id");


--
-- Name: crm_email_branding crm_email_branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_branding"
    ADD CONSTRAINT "crm_email_branding_pkey" PRIMARY KEY ("project_id");


--
-- Name: crm_email_campaigns crm_email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_campaigns"
    ADD CONSTRAINT "crm_email_campaigns_pkey" PRIMARY KEY ("id");


--
-- Name: crm_email_domains crm_email_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_domains"
    ADD CONSTRAINT "crm_email_domains_pkey" PRIMARY KEY ("id");


--
-- Name: crm_email_inbound crm_email_inbound_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_inbound"
    ADD CONSTRAINT "crm_email_inbound_pkey" PRIMARY KEY ("id");


--
-- Name: crm_email_inbound crm_email_inbound_project_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_inbound"
    ADD CONSTRAINT "crm_email_inbound_project_id_message_id_key" UNIQUE ("project_id", "message_id");


--
-- Name: crm_email_templates crm_email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_templates"
    ADD CONSTRAINT "crm_email_templates_pkey" PRIMARY KEY ("id");


--
-- Name: crm_goal_events crm_goal_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goal_events"
    ADD CONSTRAINT "crm_goal_events_pkey" PRIMARY KEY ("id");


--
-- Name: crm_goals crm_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goals"
    ADD CONSTRAINT "crm_goals_pkey" PRIMARY KEY ("id");


--
-- Name: crm_integration_requests crm_integration_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_integration_requests"
    ADD CONSTRAINT "crm_integration_requests_pkey" PRIMARY KEY ("id");


--
-- Name: crm_invites crm_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_invites"
    ADD CONSTRAINT "crm_invites_pkey" PRIMARY KEY ("id");


--
-- Name: crm_invites crm_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_invites"
    ADD CONSTRAINT "crm_invites_token_key" UNIQUE ("token");


--
-- Name: crm_kv_store crm_kv_store_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_kv_store"
    ADD CONSTRAINT "crm_kv_store_pkey" PRIMARY KEY ("key");


--
-- Name: crm_low_stock_alerts crm_low_stock_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_low_stock_alerts"
    ADD CONSTRAINT "crm_low_stock_alerts_pkey" PRIMARY KEY ("id");


--
-- Name: crm_notifications crm_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_pkey" PRIMARY KEY ("id");


--
-- Name: crm_oauth_settings crm_oauth_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_oauth_settings"
    ADD CONSTRAINT "crm_oauth_settings_pkey" PRIMARY KEY ("id");


--
-- Name: crm_org_members crm_org_members_org_id_crm_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_org_members"
    ADD CONSTRAINT "crm_org_members_org_id_crm_user_id_key" UNIQUE ("org_id", "crm_user_id");


--
-- Name: crm_org_members crm_org_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_org_members"
    ADD CONSTRAINT "crm_org_members_pkey" PRIMARY KEY ("id");


--
-- Name: crm_organizations crm_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_organizations"
    ADD CONSTRAINT "crm_organizations_pkey" PRIMARY KEY ("id");


--
-- Name: crm_payment_credentials crm_payment_credentials_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_payment_credentials"
    ADD CONSTRAINT "crm_payment_credentials_org_id_key" UNIQUE ("org_id");


--
-- Name: crm_payment_credentials crm_payment_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_payment_credentials"
    ADD CONSTRAINT "crm_payment_credentials_pkey" PRIMARY KEY ("id");


--
-- Name: crm_projects crm_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_projects"
    ADD CONSTRAINT "crm_projects_pkey" PRIMARY KEY ("id");


--
-- Name: crm_redirect_urls crm_redirect_urls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_redirect_urls"
    ADD CONSTRAINT "crm_redirect_urls_pkey" PRIMARY KEY ("id");


--
-- Name: crm_refresh_tokens crm_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_refresh_tokens"
    ADD CONSTRAINT "crm_refresh_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: crm_refresh_tokens crm_refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_refresh_tokens"
    ADD CONSTRAINT "crm_refresh_tokens_token_hash_key" UNIQUE ("token_hash");


--
-- Name: crm_role_permissions crm_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_role_permissions"
    ADD CONSTRAINT "crm_role_permissions_pkey" PRIMARY KEY ("id");


--
-- Name: crm_roles crm_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_roles"
    ADD CONSTRAINT "crm_roles_pkey" PRIMARY KEY ("id");


--
-- Name: crm_settings crm_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_settings"
    ADD CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("id");


--
-- Name: crm_sms_settings crm_sms_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_sms_settings"
    ADD CONSTRAINT "crm_sms_settings_pkey" PRIMARY KEY ("id");


--
-- Name: crm_sms_settings crm_sms_settings_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_sms_settings"
    ADD CONSTRAINT "crm_sms_settings_project_id_key" UNIQUE ("project_id");


--
-- Name: crm_subscription_plans crm_subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_subscription_plans"
    ADD CONSTRAINT "crm_subscription_plans_pkey" PRIMARY KEY ("slug");


--
-- Name: crm_subscriptions crm_subscriptions_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_subscriptions"
    ADD CONSTRAINT "crm_subscriptions_org_id_key" UNIQUE ("org_id");


--
-- Name: crm_subscriptions crm_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_subscriptions"
    ADD CONSTRAINT "crm_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: crm_team_members crm_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members"
    ADD CONSTRAINT "crm_team_members_pkey" PRIMARY KEY ("id");


--
-- Name: crm_url_config crm_url_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_url_config"
    ADD CONSTRAINT "crm_url_config_pkey" PRIMARY KEY ("id");


--
-- Name: crm_users crm_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_users"
    ADD CONSTRAINT "crm_users_pkey" PRIMARY KEY ("id");


--
-- Name: crm_webhook_deliveries crm_webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_deliveries"
    ADD CONSTRAINT "crm_webhook_deliveries_pkey" PRIMARY KEY ("id");


--
-- Name: crm_webhook_subscriptions crm_webhook_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_subscriptions"
    ADD CONSTRAINT "crm_webhook_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_pkey" PRIMARY KEY ("id");


--
-- Name: inventory_batch_counters inventory_batch_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batch_counters"
    ADD CONSTRAINT "inventory_batch_counters_pkey" PRIMARY KEY ("project_id", "period_key");


--
-- Name: inventory_batches inventory_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batches"
    ADD CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id");


--
-- Name: order_history order_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_history"
    ADD CONSTRAINT "order_history_pkey" PRIMARY KEY ("id");


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");


--
-- Name: order_return_items order_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_return_items"
    ADD CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id");


--
-- Name: order_returns order_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_returns"
    ADD CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id");


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id");


--
-- Name: payment_webhook_events payment_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payment_webhook_events"
    ADD CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id");


--
-- Name: payment_webhook_events payment_webhook_events_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payment_webhook_events"
    ADD CONSTRAINT "payment_webhook_events_provider_event_id_key" UNIQUE ("provider", "event_id");


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id");


--
-- Name: product_configurations_l3 product_configurations_l3_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l3"
    ADD CONSTRAINT "product_configurations_l3_pkey" PRIMARY KEY ("id");


--
-- Name: product_configurations_l4 product_configurations_l4_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l4"
    ADD CONSTRAINT "product_configurations_l4_pkey" PRIMARY KEY ("id");


--
-- Name: product_configurations_l5 product_configurations_l5_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l5"
    ADD CONSTRAINT "product_configurations_l5_pkey" PRIMARY KEY ("id");


--
-- Name: product_custom_fields product_custom_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_custom_fields"
    ADD CONSTRAINT "product_custom_fields_pkey" PRIMARY KEY ("id");


--
-- Name: product_modifier_groups product_modifier_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id");


--
-- Name: product_modifier_items product_modifier_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_items"
    ADD CONSTRAINT "product_modifier_items_pkey" PRIMARY KEY ("id");


--
-- Name: product_modifier_options product_modifier_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_options"
    ADD CONSTRAINT "product_modifier_options_pkey" PRIMARY KEY ("id");


--
-- Name: product_page_views product_page_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_page_views"
    ADD CONSTRAINT "product_page_views_pkey" PRIMARY KEY ("id");


--
-- Name: product_restock_subscriptions product_restock_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_restock_subscriptions"
    ADD CONSTRAINT "product_restock_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: product_review_photos product_review_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_photos"
    ADD CONSTRAINT "product_review_photos_pkey" PRIMARY KEY ("id");


--
-- Name: product_review_votes product_review_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_votes"
    ADD CONSTRAINT "product_review_votes_pkey" PRIMARY KEY ("id");


--
-- Name: product_review_votes product_review_votes_review_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_votes"
    ADD CONSTRAINT "product_review_votes_review_id_user_id_key" UNIQUE ("review_id", "user_id");


--
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_reviews"
    ADD CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id");


--
-- Name: product_configurations_l2 product_sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l2"
    ADD CONSTRAINT "product_sizes_pkey" PRIMARY KEY ("id");


--
-- Name: product_spec_groups product_spec_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_spec_groups"
    ADD CONSTRAINT "product_spec_groups_pkey" PRIMARY KEY ("id");


--
-- Name: product_specifications product_specifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_specifications"
    ADD CONSTRAINT "product_specifications_pkey" PRIMARY KEY ("id");


--
-- Name: product_stock_log product_stock_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock_log"
    ADD CONSTRAINT "product_stock_log_pkey" PRIMARY KEY ("id");


--
-- Name: product_stock product_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock"
    ADD CONSTRAINT "product_stock_pkey" PRIMARY KEY ("id");


--
-- Name: product_stock product_stock_sku_id_warehouse_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock"
    ADD CONSTRAINT "product_stock_sku_id_warehouse_id_key" UNIQUE ("sku_id", "warehouse_id");


--
-- Name: product_tax_categories product_tax_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tax_categories"
    ADD CONSTRAINT "product_tax_categories_pkey" PRIMARY KEY ("id");


--
-- Name: product_tier_pricing product_tier_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tier_pricing"
    ADD CONSTRAINT "product_tier_pricing_pkey" PRIMARY KEY ("id");


--
-- Name: product_tier_pricing product_tier_pricing_sku_id_min_qty_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tier_pricing"
    ADD CONSTRAINT "product_tier_pricing_sku_id_min_qty_key" UNIQUE ("sku_id", "min_qty");


--
-- Name: product_configurations_l1 product_variations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l1"
    ADD CONSTRAINT "product_variations_pkey" PRIMARY KEY ("id");


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");


--
-- Name: promo_code_uses promo_code_uses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_pkey" PRIMARY KEY ("id");


--
-- Name: promo_codes promo_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_token_hash_key" UNIQUE ("token_hash");


--
-- Name: crm_role_permissions role_perm; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_role_permissions"
    ADD CONSTRAINT "role_perm" UNIQUE ("role_id", "permission");


--
-- Name: search_queries search_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."search_queries"
    ADD CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id");


--
-- Name: shipping_carriers shipping_carriers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shipping_carriers"
    ADD CONSTRAINT "shipping_carriers_code_key" UNIQUE ("code");


--
-- Name: shipping_carriers shipping_carriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shipping_carriers"
    ADD CONSTRAINT "shipping_carriers_pkey" PRIMARY KEY ("id");


--
-- Name: shipping_settings shipping_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shipping_settings"
    ADD CONSTRAINT "shipping_settings_pkey" PRIMARY KEY ("id");


--
-- Name: site_visits site_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."site_visits"
    ADD CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id");


--
-- Name: crm_projects uniq_api_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_projects"
    ADD CONSTRAINT "uniq_api_key" UNIQUE ("api_key");


--
-- Name: api_settings uniq_api_setting; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_settings"
    ADD CONSTRAINT "uniq_api_setting" UNIQUE ("project_id", "field_key");


--
-- Name: crm_settings uniq_crm_settings_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_settings"
    ADD CONSTRAINT "uniq_crm_settings_user" UNIQUE ("crm_user_id");


--
-- Name: crm_users uniq_crm_users_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_users"
    ADD CONSTRAINT "uniq_crm_users_email" UNIQUE ("email");


--
-- Name: crm_email_domains uniq_email_domain_project; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_domains"
    ADD CONSTRAINT "uniq_email_domain_project" UNIQUE ("project_id");


--
-- Name: favorites uniq_fav_user_product; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "uniq_fav_user_product" UNIQUE ("user_id", "product_id");


--
-- Name: crm_team_members uniq_member; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members"
    ADD CONSTRAINT "uniq_member" UNIQUE ("project_id", "crm_user_id");


--
-- Name: users uniq_users_email_project; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "uniq_users_email_project" UNIQUE ("project_id", "email");


--
-- Name: crm_redirect_urls uq_api_key_redirect; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_redirect_urls"
    ADD CONSTRAINT "uq_api_key_redirect" UNIQUE ("project_id", "url");


--
-- Name: crm_url_config uq_api_key_url; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_url_config"
    ADD CONSTRAINT "uq_api_key_url" UNIQUE ("project_id");


--
-- Name: crm_organizations uq_slug; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_organizations"
    ADD CONSTRAINT "uq_slug" UNIQUE ("slug");


--
-- Name: user_addresses user_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_addresses"
    ADD CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id");


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id");


--
-- Name: crm_projects_crm_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "crm_projects_crm_user_id_idx" ON "public"."crm_projects" USING "btree" ("crm_user_id");


--
-- Name: crm_projects_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "crm_projects_org_id_idx" ON "public"."crm_projects" USING "btree" ("org_id");


--
-- Name: crm_roles_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "crm_roles_project_id_idx" ON "public"."crm_roles" USING "btree" ("project_id");


--
-- Name: crm_team_members_crm_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "crm_team_members_crm_user_id_idx" ON "public"."crm_team_members" USING "btree" ("crm_user_id");


--
-- Name: crm_team_members_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "crm_team_members_project_id_idx" ON "public"."crm_team_members" USING "btree" ("project_id");


--
-- Name: favorites_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "favorites_product_id_idx" ON "public"."favorites" USING "btree" ("product_id");


--
-- Name: idx_auth_prov_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_auth_prov_project" ON "public"."crm_auth_providers" USING "btree" ("project_id");


--
-- Name: idx_booking_hours_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_booking_hours_project" ON "public"."booking_hours" USING "btree" ("project_id", "staff_id", "day_of_week");


--
-- Name: idx_booking_services_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_booking_services_project" ON "public"."booking_services" USING "btree" ("project_id");


--
-- Name: idx_booking_staff_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_booking_staff_project" ON "public"."booking_staff" USING "btree" ("project_id");


--
-- Name: idx_bookings_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bookings_project" ON "public"."bookings" USING "btree" ("project_id", "starts_at");


--
-- Name: idx_bookings_project_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bookings_project_starts" ON "public"."bookings" USING "btree" ("project_id", "starts_at" DESC);


--
-- Name: idx_bookings_reminder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bookings_reminder" ON "public"."bookings" USING "btree" ("starts_at") WHERE (("reminder_sent_at" IS NULL) AND (("status")::"text" = 'confirmed'::"text"));


--
-- Name: idx_bookings_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bookings_staff" ON "public"."bookings" USING "btree" ("staff_id", "starts_at");


--
-- Name: idx_bookings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bookings_user" ON "public"."bookings" USING "btree" ("user_id", "project_id");


--
-- Name: idx_cart_events_project_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cart_events_project_at" ON "public"."cart_events" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_cart_items_cart; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cart_items_cart" ON "public"."cart_items" USING "btree" ("cart_id");


--
-- Name: idx_cart_items_cart_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cart_items_cart_updated" ON "public"."cart_items" USING "btree" ("cart_id", "updated_at");


--
-- Name: idx_cart_items_reserved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cart_items_reserved" ON "public"."cart_items" USING "btree" ("reserved_until") WHERE ("reserved_until" IS NOT NULL);


--
-- Name: idx_carts_abandoned_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_carts_abandoned_scan" ON "public"."carts" USING "btree" ("abandoned_email_sent_at") WHERE ("abandoned_email_sent_at" IS NULL);


--
-- Name: idx_cat_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cat_project" ON "public"."product_categories" USING "btree" ("project_id");


--
-- Name: idx_chat_conv_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_chat_conv_project" ON "public"."crm_chat_conversations" USING "btree" ("project_id", "is_active", "last_message_at" DESC);


--
-- Name: idx_chat_msg_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_chat_msg_conv" ON "public"."crm_chat_messages" USING "btree" ("conversation_id", "created_at");


--
-- Name: idx_checkout_events_project_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkout_events_project_at" ON "public"."checkout_events" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_crm_alert_fires_project_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_alert_fires_project_at" ON "public"."crm_alert_fires" USING "btree" ("project_id", "fired_at" DESC);


--
-- Name: idx_crm_alerts_project_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_alerts_project_active" ON "public"."crm_alerts" USING "btree" ("project_id", "is_active");


--
-- Name: idx_crm_goal_events_goal_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_goal_events_goal_at" ON "public"."crm_goal_events" USING "btree" ("goal_id", "created_at" DESC);


--
-- Name: idx_crm_goal_events_project_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_goal_events_project_at" ON "public"."crm_goal_events" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_crm_goals_custom_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_goals_custom_event" ON "public"."crm_goals" USING "btree" ("project_id", "custom_event_name") WHERE ("custom_event_name" IS NOT NULL);


--
-- Name: idx_crm_goals_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_goals_project" ON "public"."crm_goals" USING "btree" ("project_id", "is_active");


--
-- Name: idx_crm_invites_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_invites_token" ON "public"."crm_invites" USING "btree" ("token");


--
-- Name: idx_crm_kv_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_kv_expires" ON "public"."crm_kv_store" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);


--
-- Name: idx_crm_notifications_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_notifications_project" ON "public"."crm_notifications" USING "btree" ("project_id", "created_at" DESC) WHERE ("project_id" IS NOT NULL);


--
-- Name: idx_crm_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_notifications_user_unread" ON "public"."crm_notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);


--
-- Name: idx_crm_projects_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_projects_org" ON "public"."crm_projects" USING "btree" ("org_id") WHERE ("org_id" IS NOT NULL);


--
-- Name: idx_crm_refresh_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_refresh_user" ON "public"."crm_refresh_tokens" USING "btree" ("user_id", "revoked_at", "expires_at");


--
-- Name: idx_crm_roles_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_roles_org" ON "public"."crm_roles" USING "btree" ("org_id");


--
-- Name: idx_email_inbound_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_email_inbound_project" ON "public"."crm_email_inbound" USING "btree" ("project_id", "received_at" DESC);


--
-- Name: idx_favorites_user_project_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_favorites_user_project_product" ON "public"."favorites" USING "btree" ("user_id", "project_id", "product_id");


--
-- Name: idx_intreq_connector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_intreq_connector" ON "public"."crm_integration_requests" USING "btree" ("connector");


--
-- Name: idx_intreq_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_intreq_project" ON "public"."crm_integration_requests" USING "btree" ("project_id");


--
-- Name: idx_inventory_batches_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_inventory_batches_project" ON "public"."inventory_batches" USING "btree" ("project_id", "received_at" DESC);


--
-- Name: idx_inventory_batches_sku_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_inventory_batches_sku_active" ON "public"."inventory_batches" USING "btree" ("sku_id", "is_frozen", "received_at") WHERE ("quantity_remaining" > 0);


--
-- Name: idx_inventory_batches_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_inventory_batches_warehouse" ON "public"."inventory_batches" USING "btree" ("warehouse_id", "received_at" DESC);


--
-- Name: idx_l2_low_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_l2_low_stock" ON "public"."product_configurations_l2" USING "btree" ("stock_quantity");


--
-- Name: idx_low_stock_alerts_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_low_stock_alerts_lookup" ON "public"."crm_low_stock_alerts" USING "btree" ("project_id", "sku_id", "alerted_at" DESC);


--
-- Name: idx_modifier_groups_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_modifier_groups_product" ON "public"."product_modifier_groups" USING "btree" ("product_id");


--
-- Name: idx_modifier_items_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_modifier_items_group" ON "public"."product_modifier_items" USING "btree" ("group_id");


--
-- Name: idx_mv_cohort_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_mv_cohort_unique" ON "public"."mv_cohort_retention" USING "btree" ("project_id", "cohort_month", "month_offset");


--
-- Name: idx_order_history_guest_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_guest_email" ON "public"."order_history" USING "btree" ("project_id", "customer_email") WHERE (("user_id" IS NULL) AND ("customer_email" IS NOT NULL));


--
-- Name: idx_order_history_payment_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_payment_intent" ON "public"."order_history" USING "btree" ("payment_intent_id") WHERE (("payment_intent_id")::"text" <> ''::"text");


--
-- Name: idx_order_history_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_payment_status" ON "public"."order_history" USING "btree" ("project_id", "payment_status", "created_at" DESC);


--
-- Name: idx_order_history_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_project_created" ON "public"."order_history" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_order_history_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_project_id" ON "public"."order_history" USING "btree" ("project_id");


--
-- Name: idx_order_history_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_project_status" ON "public"."order_history" USING "btree" ("project_id", "status");


--
-- Name: idx_order_history_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_history_tracking" ON "public"."order_history" USING "btree" ("tracking_number") WHERE (("tracking_number")::"text" <> ''::"text");


--
-- Name: idx_order_items_access_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_items_access_code" ON "public"."order_items" USING "btree" ("access_code") WHERE ("access_code" IS NOT NULL);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_items_order_id" ON "public"."order_items" USING "btree" ("order_id");


--
-- Name: idx_order_returns_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_returns_customer" ON "public"."order_returns" USING "btree" ("customer_user_id");


--
-- Name: idx_order_returns_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_returns_order" ON "public"."order_returns" USING "btree" ("order_id");


--
-- Name: idx_order_returns_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_returns_project_created" ON "public"."order_returns" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_order_returns_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_order_returns_project_status" ON "public"."order_returns" USING "btree" ("project_id", "status", "created_at" DESC);


--
-- Name: idx_org_members_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_org_members_org" ON "public"."crm_org_members" USING "btree" ("org_id");


--
-- Name: idx_payment_webhook_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_payment_webhook_intent" ON "public"."payment_webhook_events" USING "btree" ("payment_intent_id") WHERE ("payment_intent_id" IS NOT NULL);


--
-- Name: idx_payment_webhook_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_payment_webhook_project" ON "public"."payment_webhook_events" USING "btree" ("project_id", "received_at" DESC) WHERE ("project_id" IS NOT NULL);


--
-- Name: idx_pc_l3_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_pc_l3_parent" ON "public"."product_configurations_l3" USING "btree" ("parent_id");


--
-- Name: idx_pc_l4_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_pc_l4_parent" ON "public"."product_configurations_l4" USING "btree" ("parent_id");


--
-- Name: idx_pc_l5_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_pc_l5_parent" ON "public"."product_configurations_l5" USING "btree" ("parent_id");


--
-- Name: idx_pmo_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_pmo_group" ON "public"."product_modifier_options" USING "btree" ("group_id");


--
-- Name: idx_product_page_views_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_page_views_project_created" ON "public"."product_page_views" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_product_reviews_product_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_reviews_product_project" ON "public"."product_reviews" USING "btree" ("product_id", "project_id");


--
-- Name: idx_product_reviews_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_reviews_project_created" ON "public"."product_reviews" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_product_specifications_variation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_specifications_variation_id" ON "public"."product_specifications" USING "btree" ("variation_id");


--
-- Name: idx_product_stock_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_stock_sku" ON "public"."product_stock" USING "btree" ("sku_id");


--
-- Name: idx_product_stock_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_stock_warehouse" ON "public"."product_stock" USING "btree" ("warehouse_id");


--
-- Name: idx_products_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_products_archived" ON "public"."products" USING "btree" ("project_id", "is_archived");


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_products_category" ON "public"."products" USING "btree" ("category_id");


--
-- Name: idx_promo_codes_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_promo_codes_project" ON "public"."promo_codes" USING "btree" ("project_id");


--
-- Name: idx_promo_uses_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_promo_uses_project" ON "public"."promo_code_uses" USING "btree" ("project_id", "used_at" DESC);


--
-- Name: idx_promo_uses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_promo_uses_user" ON "public"."promo_code_uses" USING "btree" ("promo_id", "user_id");


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_refresh_tokens_user" ON "public"."refresh_tokens" USING "btree" ("user_id", "project_id", "revoked_at", "expires_at");


--
-- Name: idx_restock_subs_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_restock_subs_product" ON "public"."product_restock_subscriptions" USING "btree" ("product_id");


--
-- Name: idx_restock_subs_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_restock_subs_sku" ON "public"."product_restock_subscriptions" USING "btree" ("sku_id") WHERE ("notified_at" IS NULL);


--
-- Name: idx_return_items_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_return_items_order_item" ON "public"."order_return_items" USING "btree" ("order_item_id");


--
-- Name: idx_return_items_return; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_return_items_return" ON "public"."order_return_items" USING "btree" ("return_id");


--
-- Name: idx_review_photos_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_review_photos_review" ON "public"."product_review_photos" USING "btree" ("review_id");


--
-- Name: idx_review_votes_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_review_votes_review" ON "public"."product_review_votes" USING "btree" ("review_id");


--
-- Name: idx_search_queries_project_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_search_queries_project_at" ON "public"."search_queries" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_search_queries_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_search_queries_query" ON "public"."search_queries" USING "btree" ("project_id", "lower"(("query")::"text"));


--
-- Name: idx_site_visits_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_site_visits_project_created" ON "public"."site_visits" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_spec_groups_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_spec_groups_node" ON "public"."product_spec_groups" USING "btree" ("product_id", "layer", "parent_id");


--
-- Name: idx_stock_log_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_log_project" ON "public"."product_stock_log" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_stock_log_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_log_sku" ON "public"."product_stock_log" USING "btree" ("sku_id", "created_at" DESC);


--
-- Name: idx_tax_categories_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tax_categories_project" ON "public"."product_tax_categories" USING "btree" ("project_id");


--
-- Name: idx_team_members_org_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_team_members_org_user" ON "public"."crm_team_members" USING "btree" ("org_id", "crm_user_id");


--
-- Name: idx_team_members_project_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_team_members_project_user" ON "public"."crm_team_members" USING "btree" ("project_id", "crm_user_id");


--
-- Name: idx_tier_pricing_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tier_pricing_sku" ON "public"."product_tier_pricing" USING "btree" ("sku_id", "min_qty");


--
-- Name: idx_user_addresses_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_user_addresses_owner" ON "public"."user_addresses" USING "btree" ("project_id", "user_id");


--
-- Name: idx_users_org_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_users_org_email" ON "public"."users" USING "btree" ("org_id", "email");


--
-- Name: idx_users_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_users_project_id" ON "public"."users" USING "btree" ("id", "project_id");


--
-- Name: idx_warehouses_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_warehouses_project" ON "public"."warehouses" USING "btree" ("project_id");


--
-- Name: idx_webhook_deliv_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_webhook_deliv_project" ON "public"."crm_webhook_deliveries" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: idx_webhook_deliv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_webhook_deliv_sub" ON "public"."crm_webhook_deliveries" USING "btree" ("subscription_id", "created_at" DESC);


--
-- Name: idx_webhook_subs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_webhook_subs_project" ON "public"."crm_webhook_subscriptions" USING "btree" ("project_id");


--
-- Name: ix_email_campaigns_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_email_campaigns_due" ON "public"."crm_email_campaigns" USING "btree" ("next_run_at") WHERE (("status")::"text" = 'scheduled'::"text");


--
-- Name: ix_email_campaigns_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_email_campaigns_project" ON "public"."crm_email_campaigns" USING "btree" ("project_id", "created_at" DESC);


--
-- Name: ix_subs_paddle_cust; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_subs_paddle_cust" ON "public"."crm_subscriptions" USING "btree" ("paddle_customer_id") WHERE ("paddle_customer_id" IS NOT NULL);


--
-- Name: ix_subs_paddle_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_subs_paddle_sub" ON "public"."crm_subscriptions" USING "btree" ("paddle_subscription_id") WHERE ("paddle_subscription_id" IS NOT NULL);


--
-- Name: order_history_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "order_history_project_id_idx" ON "public"."order_history" USING "btree" ("project_id");


--
-- Name: product_page_views_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "product_page_views_created_at_idx" ON "public"."product_page_views" USING "btree" ("created_at");


--
-- Name: product_page_views_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "product_page_views_project_id_idx" ON "public"."product_page_views" USING "btree" ("project_id");


--
-- Name: product_sizes_product_id_variation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "product_sizes_product_id_variation_id_idx" ON "public"."product_configurations_l2" USING "btree" ("product_id", "variation_id");


--
-- Name: product_variations_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "product_variations_product_id_idx" ON "public"."product_configurations_l1" USING "btree" ("product_id");


--
-- Name: products_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "products_project_id_idx" ON "public"."products" USING "btree" ("project_id");


--
-- Name: site_visits_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "site_visits_project_id_idx" ON "public"."site_visits" USING "btree" ("project_id");


--
-- Name: uq_booking_services_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_booking_services_product" ON "public"."booking_services" USING "btree" ("product_id") WHERE ("product_id" IS NOT NULL);


--
-- Name: uq_cat_project_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_cat_project_name" ON "public"."product_categories" USING "btree" ("project_id", "lower"(("name")::"text"));


--
-- Name: uq_cat_project_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_cat_project_slug" ON "public"."product_categories" USING "btree" ("project_id", "slug");


--
-- Name: uq_email_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_email_project" ON "public"."users" USING "btree" ("email", "project_id");


--
-- Name: uq_email_tpl_global; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_email_tpl_global" ON "public"."crm_email_templates" USING "btree" ("type") WHERE ("project_id" IS NULL);


--
-- Name: uq_email_tpl_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_email_tpl_project" ON "public"."crm_email_templates" USING "btree" ("project_id", "type") WHERE ("project_id" IS NOT NULL);


--
-- Name: uq_l2_project_sku_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_l2_project_sku_code" ON "public"."product_configurations_l2" USING "btree" ("product_id", "sku_code") WHERE (("sku_code")::"text" <> ''::"text");


--
-- Name: uq_phone_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_phone_project" ON "public"."users" USING "btree" ("phone", "project_id") WHERE (("phone" IS NOT NULL) AND (("phone")::"text" <> ''::"text"));


--
-- Name: uq_products_project_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_products_project_sku" ON "public"."products" USING "btree" ("project_id", "sku") WHERE (("sku")::"text" <> ''::"text");


--
-- Name: uq_promo_code_per_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_promo_code_per_project" ON "public"."promo_codes" USING "btree" ("project_id", "code");


--
-- Name: uq_warehouses_default_per_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_warehouses_default_per_project" ON "public"."warehouses" USING "btree" ("project_id") WHERE "is_default";


--
-- Name: cart_items trg_cart_items_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_cart_items_touch" BEFORE INSERT OR UPDATE ON "public"."cart_items" FOR EACH ROW EXECUTE FUNCTION "public"."touch_cart_items_updated_at"();


--
-- Name: product_configurations_l2 trg_l2_stock_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_l2_stock_audit" AFTER UPDATE OF "stock_quantity" ON "public"."product_configurations_l2" FOR EACH ROW EXECUTE FUNCTION "public"."log_l2_stock_change"();


--
-- Name: api_settings api_settings_crm_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_settings"
    ADD CONSTRAINT "api_settings_crm_user_id_fkey" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: api_settings api_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_settings"
    ADD CONSTRAINT "api_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: booking_hours booking_hours_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_hours"
    ADD CONSTRAINT "booking_hours_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: booking_hours booking_hours_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_hours"
    ADD CONSTRAINT "booking_hours_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."booking_staff"("id") ON DELETE CASCADE;


--
-- Name: booking_services booking_services_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_services"
    ADD CONSTRAINT "booking_services_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: booking_services booking_services_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_services"
    ADD CONSTRAINT "booking_services_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: booking_settings booking_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_settings"
    ADD CONSTRAINT "booking_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: booking_staff booking_staff_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: booking_staff_services booking_staff_services_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_staff_services"
    ADD CONSTRAINT "booking_staff_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."booking_services"("id") ON DELETE CASCADE;


--
-- Name: booking_staff_services booking_staff_services_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."booking_staff_services"
    ADD CONSTRAINT "booking_staff_services_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."booking_staff"("id") ON DELETE CASCADE;


--
-- Name: bookings bookings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: bookings bookings_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."booking_services"("id") ON DELETE RESTRICT;


--
-- Name: bookings bookings_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."booking_staff"("id") ON DELETE SET NULL;


--
-- Name: cart_events cart_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_events"
    ADD CONSTRAINT "cart_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE CASCADE;


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: cart_items cart_items_size_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_size_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: cart_items cart_items_variation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "public"."product_configurations_l1"("id") ON DELETE CASCADE;


--
-- Name: carts carts_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: checkout_events checkout_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkout_events"
    ADD CONSTRAINT "checkout_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_alert_fires crm_alert_fires_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alert_fires"
    ADD CONSTRAINT "crm_alert_fires_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "public"."crm_alerts"("id") ON DELETE CASCADE;


--
-- Name: crm_alert_fires crm_alert_fires_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alert_fires"
    ADD CONSTRAINT "crm_alert_fires_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_alerts crm_alerts_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_alerts"
    ADD CONSTRAINT "crm_alerts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_auth_providers crm_auth_providers_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_auth_providers"
    ADD CONSTRAINT "crm_auth_providers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_chat_conversations crm_chat_conversations_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_conversations"
    ADD CONSTRAINT "crm_chat_conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_chat_integrations crm_chat_integrations_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_integrations"
    ADD CONSTRAINT "crm_chat_integrations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_chat_messages crm_chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_messages"
    ADD CONSTRAINT "crm_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."crm_chat_conversations"("id") ON DELETE CASCADE;


--
-- Name: crm_chat_messages crm_chat_messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_chat_messages"
    ADD CONSTRAINT "crm_chat_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;


--
-- Name: crm_document_settings crm_document_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_document_settings"
    ADD CONSTRAINT "crm_document_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_email_branding crm_email_branding_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_branding"
    ADD CONSTRAINT "crm_email_branding_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_email_campaigns crm_email_campaigns_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_campaigns"
    ADD CONSTRAINT "crm_email_campaigns_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_email_domains crm_email_domains_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_domains"
    ADD CONSTRAINT "crm_email_domains_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_email_inbound crm_email_inbound_conv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_inbound"
    ADD CONSTRAINT "crm_email_inbound_conv_id_fkey" FOREIGN KEY ("conv_id") REFERENCES "public"."crm_chat_conversations"("id") ON DELETE SET NULL;


--
-- Name: crm_email_inbound crm_email_inbound_msg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_inbound"
    ADD CONSTRAINT "crm_email_inbound_msg_id_fkey" FOREIGN KEY ("msg_id") REFERENCES "public"."crm_chat_messages"("id") ON DELETE SET NULL;


--
-- Name: crm_email_inbound crm_email_inbound_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_inbound"
    ADD CONSTRAINT "crm_email_inbound_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_email_templates crm_email_templates_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_email_templates"
    ADD CONSTRAINT "crm_email_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_goal_events crm_goal_events_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goal_events"
    ADD CONSTRAINT "crm_goal_events_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."crm_goals"("id") ON DELETE CASCADE;


--
-- Name: crm_goal_events crm_goal_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goal_events"
    ADD CONSTRAINT "crm_goal_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_goals crm_goals_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_goals"
    ADD CONSTRAINT "crm_goals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_integration_requests crm_integration_requests_crm_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_integration_requests"
    ADD CONSTRAINT "crm_integration_requests_crm_user_id_fkey" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_integration_requests crm_integration_requests_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_integration_requests"
    ADD CONSTRAINT "crm_integration_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_invites crm_invites_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_invites"
    ADD CONSTRAINT "crm_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."crm_organizations"("id") ON DELETE CASCADE;


--
-- Name: crm_low_stock_alerts crm_low_stock_alerts_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_low_stock_alerts"
    ADD CONSTRAINT "crm_low_stock_alerts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_notifications crm_notifications_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_notifications crm_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_oauth_settings crm_oauth_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_oauth_settings"
    ADD CONSTRAINT "crm_oauth_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_org_members crm_org_members_crm_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_org_members"
    ADD CONSTRAINT "crm_org_members_crm_user_id_fkey" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_org_members crm_org_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_org_members"
    ADD CONSTRAINT "crm_org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."crm_organizations"("id") ON DELETE CASCADE;


--
-- Name: crm_organizations crm_organizations_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_organizations"
    ADD CONSTRAINT "crm_organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_organizations crm_organizations_plan_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_organizations"
    ADD CONSTRAINT "crm_organizations_plan_slug_fkey" FOREIGN KEY ("plan_slug") REFERENCES "public"."crm_subscription_plans"("slug");


--
-- Name: crm_payment_credentials crm_payment_credentials_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_payment_credentials"
    ADD CONSTRAINT "crm_payment_credentials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."crm_organizations"("id") ON DELETE CASCADE;


--
-- Name: crm_projects crm_projects_crm_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_projects"
    ADD CONSTRAINT "crm_projects_crm_user_id_fkey" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_projects crm_projects_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_projects"
    ADD CONSTRAINT "crm_projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."crm_organizations"("id") ON DELETE SET NULL;


--
-- Name: crm_redirect_urls crm_redirect_urls_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_redirect_urls"
    ADD CONSTRAINT "crm_redirect_urls_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_refresh_tokens crm_refresh_tokens_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_refresh_tokens"
    ADD CONSTRAINT "crm_refresh_tokens_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."crm_refresh_tokens"("id") ON DELETE SET NULL;


--
-- Name: crm_refresh_tokens crm_refresh_tokens_rotated_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_refresh_tokens"
    ADD CONSTRAINT "crm_refresh_tokens_rotated_to_id_fkey" FOREIGN KEY ("rotated_to_id") REFERENCES "public"."crm_refresh_tokens"("id") ON DELETE SET NULL;


--
-- Name: crm_refresh_tokens crm_refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_refresh_tokens"
    ADD CONSTRAINT "crm_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_role_permissions crm_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_role_permissions"
    ADD CONSTRAINT "crm_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."crm_roles"("id") ON DELETE CASCADE;


--
-- Name: crm_roles crm_roles_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_roles"
    ADD CONSTRAINT "crm_roles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_settings crm_settings_crm_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_settings"
    ADD CONSTRAINT "crm_settings_crm_user_id_fkey" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_sms_settings crm_sms_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_sms_settings"
    ADD CONSTRAINT "crm_sms_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_subscriptions crm_subscriptions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_subscriptions"
    ADD CONSTRAINT "crm_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."crm_organizations"("id") ON DELETE CASCADE;


--
-- Name: crm_subscriptions crm_subscriptions_plan_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_subscriptions"
    ADD CONSTRAINT "crm_subscriptions_plan_slug_fkey" FOREIGN KEY ("plan_slug") REFERENCES "public"."crm_subscription_plans"("slug");


--
-- Name: crm_team_members crm_team_members_crm_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members"
    ADD CONSTRAINT "crm_team_members_crm_role_id_fkey" FOREIGN KEY ("crm_role_id") REFERENCES "public"."crm_roles"("id") ON DELETE CASCADE;


--
-- Name: crm_team_members crm_team_members_crm_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members"
    ADD CONSTRAINT "crm_team_members_crm_user_id_fkey" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;


--
-- Name: crm_team_members crm_team_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members"
    ADD CONSTRAINT "crm_team_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;


--
-- Name: crm_team_members crm_team_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_team_members"
    ADD CONSTRAINT "crm_team_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_url_config crm_url_config_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_url_config"
    ADD CONSTRAINT "crm_url_config_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_webhook_deliveries crm_webhook_deliveries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_deliveries"
    ADD CONSTRAINT "crm_webhook_deliveries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: crm_webhook_deliveries crm_webhook_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_deliveries"
    ADD CONSTRAINT "crm_webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."crm_webhook_subscriptions"("id") ON DELETE CASCADE;


--
-- Name: crm_webhook_subscriptions crm_webhook_subscriptions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_webhook_subscriptions"
    ADD CONSTRAINT "crm_webhook_subscriptions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: favorites favorites_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: favorites favorites_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_modifier_groups fk_modifier_default_item; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "fk_modifier_default_item" FOREIGN KEY ("default_item_id") REFERENCES "public"."product_modifier_items"("id") ON DELETE SET NULL;


--
-- Name: products fk_products_tax_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "fk_products_tax_category" FOREIGN KEY ("tax_category_id") REFERENCES "public"."product_tax_categories"("id") ON DELETE SET NULL;


--
-- Name: product_specifications fk_spec_group; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_specifications"
    ADD CONSTRAINT "fk_spec_group" FOREIGN KEY ("group_id") REFERENCES "public"."product_spec_groups"("id") ON DELETE CASCADE;


--
-- Name: user_addresses fk_user_addresses_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_addresses"
    ADD CONSTRAINT "fk_user_addresses_project" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: inventory_batch_counters inventory_batch_counters_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batch_counters"
    ADD CONSTRAINT "inventory_batch_counters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batches"
    ADD CONSTRAINT "inventory_batches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_received_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batches"
    ADD CONSTRAINT "inventory_batches_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;


--
-- Name: inventory_batches inventory_batches_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batches"
    ADD CONSTRAINT "inventory_batches_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inventory_batches"
    ADD CONSTRAINT "inventory_batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;


--
-- Name: order_history order_history_carrier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_history"
    ADD CONSTRAINT "order_history_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "public"."shipping_carriers"("id") ON DELETE SET NULL;


--
-- Name: order_history order_history_pickup_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_history"
    ADD CONSTRAINT "order_history_pickup_warehouse_id_fkey" FOREIGN KEY ("pickup_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;


--
-- Name: order_history order_history_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_history"
    ADD CONSTRAINT "order_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE SET NULL;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."order_history"("id") ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: order_items order_items_size_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_size_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: order_items order_items_variation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "public"."product_configurations_l1"("id") ON DELETE CASCADE;


--
-- Name: order_return_items order_return_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_return_items"
    ADD CONSTRAINT "order_return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;


--
-- Name: order_return_items order_return_items_restock_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_return_items"
    ADD CONSTRAINT "order_return_items_restock_batch_id_fkey" FOREIGN KEY ("restock_batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE SET NULL;


--
-- Name: order_return_items order_return_items_restock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_return_items"
    ADD CONSTRAINT "order_return_items_restock_warehouse_id_fkey" FOREIGN KEY ("restock_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;


--
-- Name: order_return_items order_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_return_items"
    ADD CONSTRAINT "order_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "public"."order_returns"("id") ON DELETE CASCADE;


--
-- Name: order_returns order_returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_returns"
    ADD CONSTRAINT "order_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."order_history"("id") ON DELETE CASCADE;


--
-- Name: order_returns order_returns_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_returns"
    ADD CONSTRAINT "order_returns_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: payment_webhook_events payment_webhook_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payment_webhook_events"
    ADD CONSTRAINT "payment_webhook_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE SET NULL;


--
-- Name: product_categories product_categories_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_configurations_l3 product_configurations_l3_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l3"
    ADD CONSTRAINT "product_configurations_l3_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: product_configurations_l4 product_configurations_l4_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l4"
    ADD CONSTRAINT "product_configurations_l4_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."product_configurations_l3"("id") ON DELETE CASCADE;


--
-- Name: product_configurations_l5 product_configurations_l5_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l5"
    ADD CONSTRAINT "product_configurations_l5_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."product_configurations_l4"("id") ON DELETE CASCADE;


--
-- Name: product_custom_fields product_custom_fields_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_custom_fields"
    ADD CONSTRAINT "product_custom_fields_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_custom_fields product_custom_fields_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_custom_fields"
    ADD CONSTRAINT "product_custom_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_modifier_groups product_modifier_groups_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_modifier_items product_modifier_items_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_modifier_items"
    ADD CONSTRAINT "product_modifier_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."product_modifier_groups"("id") ON DELETE CASCADE;


--
-- Name: product_page_views product_page_views_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_page_views"
    ADD CONSTRAINT "product_page_views_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_page_views product_page_views_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_page_views"
    ADD CONSTRAINT "product_page_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE SET NULL;


--
-- Name: product_restock_subscriptions product_restock_subscriptions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_restock_subscriptions"
    ADD CONSTRAINT "product_restock_subscriptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_restock_subscriptions product_restock_subscriptions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_restock_subscriptions"
    ADD CONSTRAINT "product_restock_subscriptions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_restock_subscriptions product_restock_subscriptions_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_restock_subscriptions"
    ADD CONSTRAINT "product_restock_subscriptions_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: product_review_photos product_review_photos_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_photos"
    ADD CONSTRAINT "product_review_photos_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."product_reviews"("id") ON DELETE CASCADE;


--
-- Name: product_review_votes product_review_votes_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_review_votes"
    ADD CONSTRAINT "product_review_votes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."product_reviews"("id") ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_reviews"
    ADD CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_reviews"
    ADD CONSTRAINT "product_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_configurations_l2 product_sizes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l2"
    ADD CONSTRAINT "product_sizes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_configurations_l2 product_sizes_variation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l2"
    ADD CONSTRAINT "product_sizes_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "public"."product_configurations_l1"("id") ON DELETE CASCADE;


--
-- Name: product_spec_groups product_spec_groups_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_spec_groups"
    ADD CONSTRAINT "product_spec_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: product_specifications product_specifications_variation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_specifications"
    ADD CONSTRAINT "product_specifications_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "public"."product_configurations_l1"("id") ON DELETE CASCADE;


--
-- Name: product_stock_log product_stock_log_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock_log"
    ADD CONSTRAINT "product_stock_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_stock_log product_stock_log_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock_log"
    ADD CONSTRAINT "product_stock_log_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: product_stock_log product_stock_log_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock_log"
    ADD CONSTRAINT "product_stock_log_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;


--
-- Name: product_stock product_stock_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock"
    ADD CONSTRAINT "product_stock_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: product_stock product_stock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_stock"
    ADD CONSTRAINT "product_stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;


--
-- Name: product_tax_categories product_tax_categories_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tax_categories"
    ADD CONSTRAINT "product_tax_categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: product_tier_pricing product_tier_pricing_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_tier_pricing"
    ADD CONSTRAINT "product_tier_pricing_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."product_configurations_l2"("id") ON DELETE CASCADE;


--
-- Name: product_configurations_l1 product_variations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_configurations_l1"
    ADD CONSTRAINT "product_variations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE SET NULL;


--
-- Name: products products_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: promo_code_uses promo_code_uses_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: promo_code_uses promo_code_uses_promo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE CASCADE;


--
-- Name: promo_codes promo_codes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."refresh_tokens"("id") ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_rotated_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_rotated_to_id_fkey" FOREIGN KEY ("rotated_to_id") REFERENCES "public"."refresh_tokens"("id") ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;


--
-- Name: search_queries search_queries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."search_queries"
    ADD CONSTRAINT "search_queries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: shipping_settings shipping_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shipping_settings"
    ADD CONSTRAINT "shipping_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: site_visits site_visits_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."site_visits"
    ADD CONSTRAINT "site_visits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE SET NULL;


--
-- Name: users users_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- Name: warehouses warehouses_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."crm_projects"("id") ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

-- (end of dump)

