from getpass import getpass

from argon2 import PasswordHasher


def main() -> None:
    password = getpass("Пароль администратора: ")
    if len(password) < 12:
        raise SystemExit("Используйте не менее 12 символов.")
    if password != getpass("Повторите пароль: "):
        raise SystemExit("Пароли не совпадают.")
    print(PasswordHasher().hash(password))


if __name__ == "__main__":
    main()
