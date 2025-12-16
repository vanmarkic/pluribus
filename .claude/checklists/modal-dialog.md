# Modal Dialog Testing Checklist

Use this checklist when testing modal dialogs, popups, and overlays.

## Opening
- [ ] Modal opens from trigger (button, link, shortcut)
- [ ] Opening animation smooth (if applicable)
- [ ] Backdrop/overlay appears behind modal
- [ ] Body scroll is locked when modal open
- [ ] Focus moves into modal on open

## Closing
- [ ] X button closes modal
- [ ] ESC key closes modal (even when focus in text field)
- [ ] Click outside/backdrop closes modal (if expected)
- [ ] Close button/Cancel action closes modal
- [ ] Closing animation smooth (if applicable)

## Focus Management
- [ ] Focus trapped inside modal (Tab doesn't escape)
- [ ] First focusable element receives focus on open
- [ ] Tab order is logical within modal
- [ ] Focus returns to trigger element on close
- [ ] All interactive elements reachable via keyboard

## Accessibility
- [ ] Modal has role="dialog" or role="alertdialog"
- [ ] Modal has aria-modal="true"
- [ ] Modal has aria-labelledby pointing to title
- [ ] Screen reader announces modal opening

## Content & Layout
- [ ] Title clearly describes modal purpose
- [ ] Content is scrollable if too long
- [ ] Primary action button is prominent
- [ ] Destructive actions are visually distinct
- [ ] Responsive on different screen sizes

## State Preservation
- [ ] Form data preserved if accidentally closed (or warned)
- [ ] Unsaved changes warning before close
- [ ] Loading states shown for async actions
- [ ] Error states displayed within modal

## Multiple Modals (if applicable)
- [ ] Stacking order correct
- [ ] Only topmost modal is interactive
- [ ] Closing one doesn't close all
