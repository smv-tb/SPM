-- An archived project is read-only. Enforced here, not only in the routes, so
-- Hermes, scripts and psql sessions cannot write to one either.
--
-- Trigger arguments:
--   tables with their own "projectId": no arguments;
--   child tables: (parent table, this table's column pointing at it).
-- A row whose project (or parent) no longer exists is let through: that is a
-- cascade from a project being deleted, which the delete route un-archives
-- first in the same transaction.
-- The books' projectId columns (invoices, credit notes, journal lines) are
-- tracking dimensions on company-wide documents and are deliberately not covered.

CREATE FUNCTION project_archived_for(row_data jsonb, parent_table text, parent_column text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  pid text;
BEGIN
  IF row_data IS NULL THEN
    RETURN false;
  END IF;
  IF parent_table IS NULL THEN
    pid := row_data->>'projectId';
  ELSE
    EXECUTE format('SELECT "projectId" FROM %I WHERE id = $1', parent_table)
      INTO pid USING row_data->>parent_column;
  END IF;
  IF pid IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM projects WHERE id = pid AND "archivedAt" IS NOT NULL);
END;
$$;

CREATE FUNCTION refuse_archived_project_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_table text := CASE WHEN TG_NARGS > 0 THEN TG_ARGV[0] END;
  parent_column text := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] END;
BEGIN
  IF (TG_OP <> 'INSERT' AND project_archived_for(to_jsonb(OLD), parent_table, parent_column))
     OR (TG_OP <> 'DELETE' AND project_archived_for(to_jsonb(NEW), parent_table, parent_column)) THEN
    RAISE EXCEPTION 'PROJECT_ARCHIVED: % belongs to an archived project; restore the project first', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phases_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "phases"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER tags_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "tags"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER milestones_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "milestones"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER tasks_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER resources_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "resources"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER funding_records_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "funding_records"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER living_labs_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "living_labs"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER custom_field_definitions_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "custom_field_definitions"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();
CREATE TRIGGER cash_transactions_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "cash_transactions"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write();

CREATE TRIGGER funding_tranches_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "funding_tranches"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('funding_records', 'fundingRecordId');
CREATE TRIGGER living_lab_costs_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "living_lab_costs"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('living_labs', 'labId');
CREATE TRIGGER task_assignments_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "task_assignments"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('tasks', 'taskId');
CREATE TRIGGER task_tags_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "task_tags"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('tasks', 'taskId');
CREATE TRIGGER milestone_tags_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "milestone_tags"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('milestones', 'milestoneId');
CREATE TRIGGER resource_tags_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "resource_tags"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('resources', 'resourceId');
CREATE TRIGGER resource_milestones_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "resource_milestones"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('resources', 'resourceId');
CREATE TRIGGER custom_field_values_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON "custom_field_values"
  FOR EACH ROW EXECUTE FUNCTION refuse_archived_project_write('custom_field_definitions', 'definitionId');
