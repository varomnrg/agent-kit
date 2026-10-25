# Deepening a module

Use this reference when several callers coordinate related dependencies.

1. List the caller-visible decisions, not merely imported modules.
2. Classify dependencies as domain behavior, external adapter, policy, or
   incidental mechanism.
3. Keep domain behavior and policy local to the module when callers should not
   choose them repeatedly.
4. Put an external adapter behind a seam only when variation or testing needs it.
5. Keep incidental mechanism private.
6. Replace shallow layers rather than wrapping them with another shallow layer.
7. Compare before and after by interface facts, caller coordination, test
   surface, and places a future fix must touch.

A successful deepening removes knowledge from callers. A file move without that
change is not depth.
