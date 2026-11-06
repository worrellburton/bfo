/**
 * The design system's components, in one place (docs/DESIGN.md §14.3).
 * Areas import from here: `import { Button, Card, Page } from "../ui";`.
 * Every component root carries the `ds` scope, sizes itself from tokens,
 * and follows the theme through CSS (no isDark).
 */

export { cx } from "./cx";
export { Icon, Spinner, ICON_NAMES, type IconName } from "./icon";
export { Button, LinkButton, IconButton, TextLink, type ButtonProps, type IconButtonProps } from "./button";
export { ButtonLayout, buttonClasses, type ButtonVariant, type ButtonSize } from "./button-style";
export { Field, Input, MoneyInput, Textarea, SearchField, type InputProps } from "./field";
export { DateInput } from "./date-input";
export { Select, MultiSelect, ListboxPanel, type Option, type SelectProps, type MultiSelectProps } from "./select";
export { useListbox, type ListboxShell } from "./select-shell";
export { Segmented } from "./segmented";
export { Checkbox, ChoiceTiles, Switch } from "./choice";
export { Status, Badge, Count, FilterChip, type Tone } from "./status";
export { Card, CardSection, Row, Rows } from "./card";
export { List, ListRow, type ListRowProps } from "./list";
export { Table, type Column, type TableProps } from "./table";
export { Tabs, type TabItem } from "./tabs";
export { Toolbar } from "./toolbar";
export { Empty, Skeleton, Banner, Disclosure, InfoToggle } from "./states";
export { toast, dismissToast, type ToastOptions } from "./toast";
export { Avatar, Tooltip, Keycap, Money, DateText, AiNote, LegalLinks } from "./misc";
export { Page, PageHeader, ErrorPage } from "./page";
export { useDocumentTitle, openPalette } from "./page-title";
export { Dialog, Sheet, Menu, Popover, ConfirmView, type DialogProps, type SheetProps, type MenuItem, type ConfirmOptions, type ConfirmResult } from "./overlay";
export { confirm } from "./confirm";
export { useOverlay, usePresence, useAnchor, type UseOverlayOptions, type OverlayHandle } from "./overlay-manager";
export { useMedia, useTouch, usePhone, useNarrow, useFinePointer, useDelayed, isApple } from "./media";
export * as format from "./format";
