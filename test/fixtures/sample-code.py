import sys, os

def validate_args():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <name>")
        sys.exit(1)

def greet(name):
    print(f"Hello, {name}!")

def main():
    validate_args()
    name = sys.argv[1]
    greet(name)

if __name__ == "__main__":
    main()
