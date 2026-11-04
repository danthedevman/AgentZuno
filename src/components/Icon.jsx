import { Show } from 'solid-js';

const icons = {
  drawer: 'view_sidebar',
  profile: 'account_circle',
  'menu-open': 'menu',
  'menu-close': 'menu_open',
  info: 'info',
  more: 'more_vert',
  attachment: 'attach_file',
  chat: 'chat_bubble_outline',
  ticket: 'confirmation_number',
  request: 'assignment',
  archive: 'archive',
  refresh: 'refresh',
  restore: 'unarchive',
  workflow: 'account_tree',
  work: 'work_outline',
  data: 'table_chart',
  reports: 'analytics',
  users: 'group',
  check: 'check',
  loading: 'progress_activity',
  upload: 'upload',
  plus: 'add',
  close: 'close',
  neural: 'psychology',
  settings: 'settings',
  file: 'description',
  image: 'image',
  sun: 'light_mode',
  moon: 'dark_mode',
  home: 'home',
  inbox: 'inbox',
  'book-pen': 'edit_note',
  catalog: 'storefront',
  category: 'folder_open',
  'chevron-right': 'chevron_right',
  'chevron-down': 'expand_more',
  laptop: 'laptop_mac',
  software: 'apps',
  phone: 'phone_in_talk',
  book: 'menu_book',
  search: 'search',
  agent: 'smart_toy',
  plug: 'cable',
  help: 'help_outline',
  arrow: 'arrow_forward',
  back: 'arrow_back',
  sort: 'unfold_more',
  'sort-up': 'arrow_upward',
  'sort-down': 'arrow_downward',
  lock: 'lock',
  layers: 'layers',
  compass: 'explore',
  task: 'task_alt',
  user: 'person_outline',
  panel: 'vertical_split',
  edit: 'edit',
  link: 'link',
};

export default function Icon(props) {
  return (
    <Show
      when={props.name === 'agent'}
      fallback={
        <span class={`icon material-icon ${props.class || ''}`} aria-hidden="true">
          {icons[props.name] || icons.book}
        </span>
      }
    >
      <svg
        class={`icon agent-ring-icon ${props.class || ''}`}
        viewBox="0 0 80 80"
        aria-hidden="true"
      >
        <circle cx="40" cy="40" r="20" fill="none" stroke="#818CF8" stroke-width="7" />
      </svg>
    </Show>
  );
}
