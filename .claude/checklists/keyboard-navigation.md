# Keyboard Navigation Testing Checklist

Use this checklist to verify keyboard accessibility across the application.

## Global Shortcuts
- [ ] Document all keyboard shortcuts
- [ ] Shortcuts don't conflict with browser/OS defaults
- [ ] Shortcuts work regardless of focus location
- [ ] Shortcuts discoverable (tooltips, help menu)

## Tab Navigation
- [ ] All interactive elements reachable via Tab
- [ ] Tab order follows visual/logical order
- [ ] No focus traps (can always Tab out)
- [ ] Skip links for main content (if applicable)
- [ ] Focus visible on all elements (outline/ring)

## Focus Indicators
- [ ] Focus ring visible on buttons
- [ ] Focus ring visible on links
- [ ] Focus ring visible on inputs
- [ ] Focus ring visible on custom components
- [ ] Focus ring has sufficient contrast

## Common Key Patterns
- [ ] Enter activates buttons and links
- [ ] Space activates buttons and checkboxes
- [ ] Escape closes popups/modals/dropdowns
- [ ] Arrow keys navigate lists/menus/tabs
- [ ] Home/End jump to first/last item (in lists)

## Form-Specific
- [ ] Tab moves between form fields
- [ ] Enter submits form (if appropriate)
- [ ] Validation errors announced
- [ ] Error fields receive focus

## List/Grid Navigation
- [ ] Arrow keys move between items
- [ ] Enter/Space selects item
- [ ] Type-ahead search (if applicable)
- [ ] Multi-select with Shift+Arrow (if applicable)

## Screen Reader Compatibility
- [ ] Headings hierarchy correct (h1 → h2 → h3)
- [ ] ARIA labels on icon-only buttons
- [ ] Live regions for dynamic content
- [ ] Form labels associated with inputs
