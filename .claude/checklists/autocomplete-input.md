# Autocomplete Input Testing Checklist

Use this checklist when testing any text input with autocomplete/typeahead functionality.

## Dropdown Appearance
- [ ] Dropdown appears on focus
- [ ] Dropdown appears after typing minimum characters (if applicable)
- [ ] Dropdown positioned correctly (not clipped by viewport)
- [ ] Dropdown has appropriate max-height with scroll

## Type-ahead Filtering
- [ ] Typing filters results to matching items
- [ ] First letter(s) filter works (e.g., "Al" → "Alice")
- [ ] Case-insensitive matching
- [ ] Matches anywhere in text (not just prefix) if expected
- [ ] Filter updates as user types more characters
- [ ] Backspace updates filter correctly
- [ ] Empty filter shows all/recent items

## Keyboard Navigation
- [ ] ArrowDown moves selection down
- [ ] ArrowUp moves selection up
- [ ] Selection wraps (bottom → top, top → bottom)
- [ ] Currently selected item is visually highlighted
- [ ] Enter selects highlighted item
- [ ] Escape closes dropdown without selecting
- [ ] Tab behavior (closes? selects? moves focus?)

## Mouse Interaction
- [ ] Hover highlights item
- [ ] Click selects item
- [ ] Click outside closes dropdown

## Selection Behavior
- [ ] Selected item populates input correctly
- [ ] Input value format is correct (name, email, or both)
- [ ] Cursor position after selection
- [ ] Can continue typing after selection (if multi-value)

## Empty/Error States
- [ ] "No results" shown when nothing matches
- [ ] Loading state while fetching (if async)
- [ ] Error state if fetch fails

## Multi-value Inputs (e.g., email To field)
- [ ] Multiple selections supported
- [ ] Chips/tags display for selections
- [ ] Can remove individual selections
- [ ] Comma/Enter adds current value
- [ ] Duplicate prevention
