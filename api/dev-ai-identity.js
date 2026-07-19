module.exports = function disabledProductionDevAiIdentity(_req, res) {
  return res.status(404).json({ error: "Not found." });
};
