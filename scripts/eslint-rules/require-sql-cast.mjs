const SQL_CAST_START = /^::(?:[A-Za-z_]|")/

export default {
  meta: {
    type: "problem",
    docs: {
      description: "require an explicit Postgres cast after every SQL template interpolation",
    },
    schema: [],
    messages: {
      missingCast: "SQL interpolation must be followed immediately by an explicit Postgres ::cast.",
    },
  },
  create(context) {
    return {
      TaggedTemplateExpression(node) {
        if (node.tag.type !== "Identifier" || node.tag.name !== "sql") return

        const expressions = node.quasi.expressions
        const quasis = node.quasi.quasis
        expressions.forEach((expression, index) => {
          const trailingText = quasis[index + 1]?.value.raw ?? ""
          if (!SQL_CAST_START.test(trailingText)) {
            context.report({ node: expression, messageId: "missingCast" })
          }
        })
      },
    }
  },
}
