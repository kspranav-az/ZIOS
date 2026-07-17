/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn('evaluation_report', {
    cost: { type: 'numeric(12,6)', notNull: false, default: 0 },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn('evaluation_report', 'cost');
};
