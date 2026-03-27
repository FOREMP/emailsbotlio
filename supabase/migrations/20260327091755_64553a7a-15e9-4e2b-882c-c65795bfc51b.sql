-- Drop simulation-related tables
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS seed_materials CASCADE;
DROP TABLE IF EXISTS simulations CASCADE;

-- Drop enums
DROP TYPE IF EXISTS simulation_status CASCADE;
DROP TYPE IF EXISTS seed_material_type CASCADE;