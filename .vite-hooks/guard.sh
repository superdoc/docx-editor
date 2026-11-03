hooks_dir="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
hooks_package="$(dirname "$hooks_dir")"
committing_top="$(git rev-parse --show-toplevel)" || exit 1
[ -n "$committing_top" ] || exit 1
committing_root="$(cd "$committing_top" && pwd -P)" || exit 1
hooks_top="$(unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; git -C "$hooks_package" rev-parse --show-toplevel)" || exit 1
hooks_root="$(cd "$hooks_top" && pwd -P)" || exit 1
if [ "$hooks_root" != "$committing_root" ]; then
  own_hooks=".vite-hooks/_"
  [ -d "$committing_root/superdoc/public/.vite-hooks" ] && own_hooks="superdoc/public/.vite-hooks/_"
  case "$(git config --show-scope --get core.hooksPath | cut -f1)" in
    worktree) set_hooks_path="git config --worktree core.hooksPath $own_hooks" ;;
    local | global | system) set_hooks_path="git config core.hooksPath $own_hooks" ;;
    *) set_hooks_path="drop the -c core.hooksPath override, or point it at $own_hooks" ;;
  esac
  echo "$(basename "$0"): core.hooksPath runs hooks from $hooks_root, not this checkout ($committing_root)." >&2
  echo "Fix it with: $set_hooks_path" >&2
  exit 1
fi
