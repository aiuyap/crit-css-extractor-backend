const { parse } = require('css-tree');
const { CSS_CONSTANTS } = require('./constants');

class CSSParser {
  constructor(options = {}) {
    this.options = {
      includeShadows: options.includeShadows ?? false,
      includeAnimations: options.includeAnimations ?? false,
      includeTransitions: options.includeTransitions ?? false,
      includeHoverStates: options.includeHoverStates ?? false,
    };
  }

  /**
   * Parse CSS string into structured rules
   */
  parseCSS(css) {
    try {
      console.log(`Parsing CSS of length: ${css.length}`);

      // Handle empty CSS
      if (!css || css.trim().length === 0) {
        console.log('CSS is empty, returning no rules');
        return [];
      }

      const ast = parse(css, {
        parseAtrulePrelude: true,
        parseRulePrelude: true,
        parseValue: true,
        parseCustomProperty: true,
      });

      const rules = [];

      const walk = (node, mediaQuery) => {
        if (node.type === 'Rule') {
          const rule = processRule(node, mediaQuery);
          if (rule) {
            rules.push(rule);
          }
        } else if (node.type === 'Atrule') {
          // Handle @media queries
          if (node.name === 'media') {
            const mediaQueryStr = generateMediaQuery(node.prelude);

            if (node.block && node.block.children) {
              for (const child of node.block.children) {
                walk(child, mediaQueryStr);
              }
            }
          }
          // Handle @font-face
          else if (node.name === 'font-face') {
            const fontFaceRule = processFontFace(node);
            if (fontFaceRule) {
              rules.push(fontFaceRule);
            }
          }
        } else if (node.children) {
          for (const child of node.children) {
            walk(child, mediaQuery);
          }
        }
      };

      const processRule = (node, mediaQuery) => {
        if (!node.prelude || !node.block) return null;

        const selector = generateSelector(node.prelude);
        if (!selector || shouldExcludeSelector(selector)) return null;

        const declarations = processDeclarations(node.block.children);
        if (declarations.length === 0) return null;

        return {
          selector,
          declarations,
          mediaQuery,
        };
      };

      const processFontFace = (node) => {
        if (!node.block || !node.block.children) return null;

        const declarations = processDeclarations(node.block.children);
        if (declarations.length === 0) return null;

        return {
          selector: '@font-face',
          declarations,
          mediaQuery: undefined,
        };
      };

      const generateSelector = (prelude) => {
        // Handle Raw nodes (unparsed CSS)
        if (prelude.type === 'Raw') {
          return prelude.value?.trim() || '';
        }

        // Convert css-tree selector prelude to string
        if (prelude.type === 'SelectorList') {
          const selectors = [];
          if (prelude.children) {
            for (const child of prelude.children) {
              const sel = generateSelector(child);
              if (sel) selectors.push(sel);
            }
          }
          return selectors.join(', ');
        } else if (prelude.type === 'Selector') {
          const parts = [];
          if (prelude.children) {
            for (const child of prelude.children) {
              if (child.type === 'TypeSelector') parts.push(child.name);
              else if (child.type === 'ClassSelector')
                parts.push('.' + child.name);
              else if (child.type === 'IdSelector')
                parts.push('#' + child.name);
              else if (child.type === 'AttributeSelector') {
                const attrName = child.name?.name || child.name || '';
                const attrMatcher = child.matcher || '';
                const attrValue = child.value?.value || child.value?.name || '';
                if (attrMatcher && attrValue) {
                  parts.push(`[${attrName}${attrMatcher}"${attrValue}"]`);
                } else {
                  parts.push(`[${attrName}]`);
                }
              } else if (child.type === 'PseudoClassSelector') {
                let pseudoStr = ':' + child.name;
                if (child.children) {
                  const childSelectors = [];
                  for (const pc of child.children) {
                    childSelectors.push(generateSelector(pc));
                  }
                  if (childSelectors.length > 0) {
                    pseudoStr += '(' + childSelectors.join('') + ')';
                  }
                }
                parts.push(pseudoStr);
              } else if (child.type === 'PseudoElementSelector')
                parts.push('::' + child.name);
              else if (child.type === 'Combinator') {
                // Combinators: ' ', '>', '+', '~'
                const val = child.name || child.value || ' ';
                parts.push(val === ' ' ? ' ' : ' ' + val + ' ');
              } else if (child.type === 'WhiteSpace') parts.push(' ');
            }
          }
          return parts.join('');
        }
        return '';
      };

      const generateMediaQuery = (prelude) => {
        if (!prelude) return '';

        // Handle Raw nodes
        if (prelude.type === 'Raw') {
          return prelude.value?.trim() || '';
        }

        // Handle MediaQueryList
        if (prelude.type === 'MediaQueryList' && prelude.children) {
          const queries = [];
          for (const child of prelude.children) {
            queries.push(generateMediaQuery(child));
          }
          return queries.filter(Boolean).join(', ');
        }

        // Handle MediaQuery
        if (prelude.type === 'MediaQuery' && prelude.children) {
          const parts = [];
          for (const child of prelude.children) {
            parts.push(generateMediaQuery(child));
          }
          return parts.filter(Boolean).join(' ');
        }

        // Handle MediaFeature
        if (prelude.type === 'MediaFeature') {
          const name = prelude.name || '';
          if (prelude.value) {
            const val = generateMediaQuery(prelude.value);
            return `(${name}: ${val})`;
          }
          return `(${name})`;
        }

        // Handle individual tokens
        if (prelude.type === 'Identifier') return prelude.name;
        if (prelude.type === 'Number') return prelude.value;
        if (prelude.type === 'Dimension') return prelude.value + prelude.unit;
        if (prelude.type === 'Ratio') return `${prelude.left}/${prelude.right}`;
        if (prelude.type === 'Operator') return prelude.value;

        // Generic children handling
        if (prelude.children) {
          const parts = [];
          for (const child of prelude.children) {
            parts.push(generateMediaQuery(child));
          }
          return parts.filter(Boolean).join(' ');
        }

        return '';
      };

      const processDeclarations = (children) => {
        const declarations = [];

        if (!children) return declarations;

        // css-tree uses an iterable linked list
        for (const child of children) {
          if (child.type === 'Declaration') {
            const property = child.property;
            const value = generateValue(child.value);
            const important = child.important === true;

            if (shouldIncludeProperty(property, value)) {
              declarations.push({
                property,
                value,
                important,
              });
            }
          }
        }

        return declarations;
      };

      const generateValue = (valueNode) => {
        if (!valueNode) return '';

        // Handle Raw nodes
        if (valueNode.type === 'Raw') {
          return valueNode.value?.trim() || '';
        }

        // Handle Value nodes (container for value children)
        if (valueNode.type === 'Value' && valueNode.children) {
          const parts = [];
          for (const child of valueNode.children) {
            parts.push(generateValue(child));
          }
          return parts.join('');
        }

        if (valueNode.type === 'Identifier') return valueNode.name;
        if (valueNode.type === 'Number')
          return valueNode.value?.toString() || '0';
        if (valueNode.type === 'String') return `"${valueNode.value}"`;
        if (valueNode.type === 'Dimension')
          return valueNode.value + valueNode.unit;
        if (valueNode.type === 'Percentage') return valueNode.value + '%';
        if (valueNode.type === 'Hash') return '#' + valueNode.value;
        if (valueNode.type === 'Function') {
          const args = [];
          if (valueNode.children) {
            for (const child of valueNode.children) {
              args.push(generateValue(child));
            }
          }
          return valueNode.name + '(' + args.join('') + ')';
        }
        if (valueNode.type === 'Url') {
          return `url(${valueNode.value})`;
        }
        if (valueNode.type === 'Operator') return valueNode.value;
        if (valueNode.type === 'WhiteSpace') return ' ';
        if (valueNode.type === 'Comma') return ', ';

        // Generic children handling
        if (valueNode.children) {
          const parts = [];
          for (const child of valueNode.children) {
            parts.push(generateValue(child));
          }
          return parts.join('');
        }

        return '';
      };

      const shouldExcludeSelector = (selector) => {
        // Check for excluded selectors
        for (const excluded of CSS_CONSTANTS.EXCLUDED_SELECTORS) {
          if (selector.includes(excluded)) {
            return true;
          }
        }

        // Skip if no hover states allowed
        if (!this.options.includeHoverStates && selector.includes(':hover')) {
          return true;
        }

        return false;
      };

      const shouldIncludeProperty = (property, value) => {
        // Check if property is allowed
        if (!CSS_CONSTANTS.ALLOWED_PROPERTIES.includes(property)) {
          return false;
        }

        // Exclude shadows unless explicitly allowed
        if (
          !this.options.includeShadows &&
          (property.includes('shadow') || property.includes('box-shadow'))
        ) {
          return false;
        }

        // Exclude animations unless explicitly allowed
        if (
          !this.options.includeAnimations &&
          (property.includes('animation') || property.includes('keyframes'))
        ) {
          return false;
        }

        // Exclude transitions unless explicitly allowed
        if (
          !this.options.includeTransitions &&
          property.includes('transition')
        ) {
          return false;
        }

        // Exclude properties with invalid values
        if (value === 'none' || value === 'initial' || value === 'unset') {
          return false;
        }

        return true;
      };

      // Start walking the AST
      walk(ast);

      return rules;
    } catch (error) {
      console.error('CSS parsing error:', error);
      return [];
    }
  }

  /**
   * Filter CSS rules based on above-fold elements
   */
  filterCSSRules(rules, aboveFoldSelectors) {
    // Convert to array for faster lookups
    const selectorArray = Array.from(aboveFoldSelectors);

    // Build lookup sets for different selector types
    const tagSelectors = new Set();
    const classSelectors = new Set();
    const idSelectors = new Set();

    for (const sel of selectorArray) {
      if (sel.startsWith('#')) {
        idSelectors.add(sel.substring(1));
      } else if (sel.startsWith('.')) {
        classSelectors.add(sel.substring(1));
      } else if (!sel.includes('.') && !sel.includes('#')) {
        tagSelectors.add(sel.toLowerCase());
      }

      // Also extract classes from compound selectors like "div.foo.bar"
      const classMatches = sel.match(/\.([a-zA-Z0-9_-]+)/g);
      if (classMatches) {
        for (const match of classMatches) {
          classSelectors.add(match.substring(1));
        }
      }
    }

    return rules.filter((rule) => {
      // Always include @font-face rules
      if (rule.selector === '@font-face') return true;

      // Always include :root and html/body rules (global styles)
      if (
        rule.selector === ':root' ||
        rule.selector === 'html' ||
        rule.selector === 'body'
      ) {
        return true;
      }

      // Always include * (universal selector) rules
      if (rule.selector === '*') return true;

      // Check if any part of the selector matches above-fold elements
      const selectors = rule.selector.split(',').map((s) => s.trim());

      return selectors.some((selector) => {
        return this.matchesSelector(
          selector,
          tagSelectors,
          classSelectors,
          idSelectors
        );
      });
    });
  }

  /**
   * Check if a CSS selector matches any of the above-fold element selectors
   */
  matchesSelector(cssSelector, tagSelectors, classSelectors, idSelectors) {
    // Extract the parts of the CSS selector
    // For complex selectors like ".foo .bar > .baz", we check if any part matches

    // Check for ID in selector
    const idMatch = cssSelector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && idSelectors.has(idMatch[1])) {
      return true;
    }

    // Check for classes in selector
    const classMatches = cssSelector.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const match of classMatches) {
        const className = match.substring(1);
        if (classSelectors.has(className)) {
          return true;
        }
      }
    }

    // Check for tag selectors
    // Extract tag names (words at start or after combinators that aren't classes/ids)
    const tagMatches = cssSelector.match(
      /(?:^|[\s>+~])([a-zA-Z][a-zA-Z0-9]*)/g
    );
    if (tagMatches) {
      for (const match of tagMatches) {
        const tagName = match
          .trim()
          .replace(/^[\s>+~]+/, '')
          .toLowerCase();
        if (tagName && tagSelectors.has(tagName)) {
          return true;
        }
      }
    }

    // Also check if selector starts with a tag
    const startsWithTag = cssSelector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (startsWithTag) {
      const tagName = startsWithTag[1].toLowerCase();
      if (tagSelectors.has(tagName)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate CSS string from rules
   */
  generateCSS(rules) {
    const cssParts = [];

    for (const rule of rules) {
      let ruleCSS = '';

      if (rule.mediaQuery) {
        ruleCSS += `@media ${rule.mediaQuery} {\n`;
      }

      ruleCSS += `${rule.selector} {\n`;

      for (const declaration of rule.declarations) {
        const important = declaration.important ? ' !important' : '';
        ruleCSS += `  ${declaration.property}: ${declaration.value}${important};\n`;
      }

      ruleCSS += '}\n';

      if (rule.mediaQuery) {
        ruleCSS += '}\n';
      }

      cssParts.push(ruleCSS);
    }

    return cssParts.join('\n');
  }

  /**
   * Deduplicate CSS rules
   */
  deduplicateRules(rules) {
    const seen = new Set();
    const uniqueRules = [];

    for (const rule of rules) {
      const key = `${rule.selector}|${rule.mediaQuery || ''}`;

      if (!seen.has(key)) {
        seen.add(key);

        // Deduplicate declarations within the rule
        const uniqueDeclarations = this.deduplicateDeclarations(
          rule.declarations
        );

        uniqueRules.push({
          ...rule,
          declarations: uniqueDeclarations,
        });
      }
    }

    return uniqueRules;
  }

  /**
   * Deduplicate declarations within a rule
   */
  deduplicateDeclarations(declarations) {
    const seen = new Map();

    for (const decl of declarations) {
      const key = decl.property;

      // Keep the declaration with higher importance or the last one
      const existing = seen.get(key);
      if (!existing || (decl.important && !existing.important)) {
        seen.set(key, decl);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Minify CSS output
   */
  minifyCSS(css) {
    return css
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
      .replace(/\s+/g, ' ') // Collapse whitespace
      .replace(/;\s*}/g, '}') // Remove semicolons before closing brace
      .replace(/\s*{\s*/g, '{') // Collapse braces
      .replace(/;\s*/g, ';') // Collapse semicolons
      .replace(/:\s+/g, ':') // Collapse colons
      .trim();
  }
}

module.exports = { CSSParser };
